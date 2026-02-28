import prisma from "../../db/prisma.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { sanitizePagination } from "../../utils/pagination.js";
import { sanitizeSort } from "../../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../../utils/listResponse.js";
import { writeAdminAuditLog } from "../../services/admin.audit.service.js";
import {
  executeAdminAction,
  buildReportTargetSnapshot,
  hydrateReportTargets,
  resolveReportAction,
} from "../../services/admin.reportTargets.service.js";
import { REPORT_RESOLVE_STATUSES } from "../../services/admin.policy.service.js";
import {
  getDateRangeFilter,
  MAX_ADMIN_LIST_LIMIT,
  normalizeOptionalText,
  normalizeText,
} from "../../services/admin.controller.utils.js";

export const getAdminReports = asyncHandler(async (req, res) => {
  const { page, limit, skip } = sanitizePagination(req.query.page, req.query.limit, MAX_ADMIN_LIST_LIMIT);

  const { sortBy, sortType } = sanitizeSort(
    normalizeText(req.query.sortBy || "createdAt"),
    normalizeText(req.query.sortType || "desc"),
    ["createdAt", "updatedAt", "status"],
    "createdAt"
  );

  const status = normalizeText(req.query.status).toUpperCase();
  const targetType = normalizeText(req.query.targetType).toUpperCase();
  const q = normalizeText(req.query.q).slice(0, 120);
  const createdAtRange = getDateRangeFilter(req.query);

  const where = {};

  if (status) {
    if (!["PENDING", "REVIEWED", "REJECTED", "ACTION_TAKEN"].includes(status)) {
      throw new ApiError(400, "Invalid status filter");
    }
    where.status = status;
  }

  if (targetType) {
    if (!["VIDEO", "COMMENT", "USER", "CHANNEL"].includes(targetType)) {
      throw new ApiError(400, "Invalid targetType filter");
    }
    where.targetType = targetType;
  }

  if (createdAtRange) where.createdAt = createdAtRange;

  if (q) {
    where.OR = [
      { reason: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { targetId: { contains: q, mode: "insensitive" } },
      { reporter: { is: { username: { contains: q, mode: "insensitive" } } } },
      { reporter: { is: { fullName: { contains: q, mode: "insensitive" } } } },
      { reporter: { is: { email: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const [count, rows] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { [sortBy]: sortType },
      skip,
      take: limit,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        description: true,
        status: true,
        resolutionNote: true,
        actionType: true,
        actionMeta: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        reporter: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            avatar: true,
            role: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            avatar: true,
            role: true,
          },
        },
      },
    }),
  ]);

  const items = await hydrateReportTargets(rows);

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "reports",
        items,
        currentPage: page,
        limit,
        totalItems: count,
      }),
      "Admin reports fetched"
    )
  );
});

export const getAdminReportById = asyncHandler(async (req, res) => {
  const reportId = normalizeText(req.params.reportId);
  if (!reportId) throw new ApiError(400, "reportId is required");

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      reason: true,
      description: true,
      status: true,
      resolutionNote: true,
      actionType: true,
      actionMeta: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
      reporter: {
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
          avatar: true,
          role: true,
        },
      },
      resolvedBy: {
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
          avatar: true,
          role: true,
        },
      },
    },
  });

  if (!report) throw new ApiError(404, "Report not found");

  const [targetSnapshot, priorActions] = await Promise.all([
    buildReportTargetSnapshot({ targetType: report.targetType, targetId: report.targetId }),
    prisma.adminAuditLog.findMany({
      where: {
        targetType: report.targetType,
        targetId: report.targetId,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        action: true,
        reason: true,
        metadata: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            avatar: true,
            role: true,
          },
        },
      },
    }),
  ]);

  await writeAdminAuditLog({
    req,
    actor: req.user,
    action: "ADMIN_REPORT_READ",
    targetType: "REPORT",
    targetId: report.id,
    metadata: {
      reportId: report.id,
      reportTargetType: report.targetType,
      reportTargetId: report.targetId,
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        report: {
          ...report,
          target: targetSnapshot,
        },
        priorModeration: {
          totalActions: priorActions.length,
          items: priorActions,
        },
      },
      "Admin report detail fetched"
    )
  );
});

export const resolveAdminReport = asyncHandler(async (req, res) => {
  const reportId = normalizeText(req.params.reportId);
  if (!reportId) throw new ApiError(400, "reportId is required");

  const status = normalizeText(req.body?.status).toUpperCase();
  const note = normalizeOptionalText(req.body?.note, 2000);

  if (!REPORT_RESOLVE_STATUSES.has(status)) {
    throw new ApiError(400, "Invalid report status");
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      status: true,
      resolutionNote: true,
      actionType: true,
      actionMeta: true,
      resolvedById: true,
      resolvedAt: true,
    },
  });

  if (!report) throw new ApiError(404, "Report not found");

  const parsedAction = resolveReportAction(req.body?.action, report);

  let actionResult = null;
  let resolvedStatus = status;

  if (parsedAction) {
    actionResult = await executeAdminAction({
      req,
      actor: req.user,
      action: parsedAction,
      fallbackTarget: {
        targetType: report.targetType,
        targetId: report.targetId,
        reason: note,
      },
    });

    resolvedStatus = "ACTION_TAKEN";
  }

  const updated = await prisma.report.update({
    where: { id: report.id },
    data: {
      status: resolvedStatus,
      resolutionNote: note,
      resolvedById: req.user.id,
      resolvedAt: new Date(),
      actionType: parsedAction?.type || null,
      actionMeta: parsedAction
        ? {
            ...(parsedAction.payload || {}),
            actionTargetType: parsedAction.targetType,
            actionTargetId: parsedAction.targetId,
            result: actionResult,
          }
        : null,
    },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      status: true,
      resolutionNote: true,
      actionType: true,
      actionMeta: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
      reporter: {
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
          avatar: true,
          role: true,
        },
      },
      resolvedBy: {
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
          avatar: true,
          role: true,
        },
      },
    },
  });

  await writeAdminAuditLog({
    req,
    actor: req.user,
    action: "ADMIN_REPORT_RESOLVE",
    targetType: "REPORT",
    targetId: report.id,
    reason: note,
    before: report,
    after: {
      status: updated.status,
      resolutionNote: updated.resolutionNote,
      actionType: updated.actionType,
      actionMeta: updated.actionMeta,
      resolvedById: updated.resolvedBy?.id,
      resolvedAt: updated.resolvedAt,
    },
    metadata: {
      requestedStatus: status,
      finalStatus: updated.status,
      hasAction: Boolean(parsedAction),
      actionType: parsedAction?.type || null,
    },
  });

  const targetSnapshot = await buildReportTargetSnapshot({
    targetType: updated.targetType,
    targetId: updated.targetId,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        report: {
          ...updated,
          target: targetSnapshot,
        },
        actionResult,
      },
      "Report resolved"
    )
  );
});
