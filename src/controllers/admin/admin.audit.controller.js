import prisma from "../../db/prisma.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { sanitizePagination } from "../../utils/pagination.js";
import { sanitizeSort } from "../../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../../utils/listResponse.js";
import { writeAdminAuditLog } from "../../services/admin.audit.service.js";
import {
  getDateRangeFilter,
  MAX_ADMIN_LIST_LIMIT,
  normalizeText,
  toUserSummary,
  ensureRequiredId,
} from "../../services/admin.controller.utils.js";

export const getAdminAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = sanitizePagination(req.query.page, req.query.limit, MAX_ADMIN_LIST_LIMIT);

  const { sortBy, sortType } = sanitizeSort(
    normalizeText(req.query.sortBy || "createdAt"),
    normalizeText(req.query.sortType || "desc"),
    ["createdAt", "action", "targetType"],
    "createdAt"
  );

  const where = {};

  const actorId = normalizeText(req.query.actorId);
  const action = normalizeText(req.query.action);
  const targetType = normalizeText(req.query.targetType).toUpperCase();
  const targetId = normalizeText(req.query.targetId);
  const createdAt = getDateRangeFilter(req.query);

  if (actorId) where.actorId = actorId;
  if (action) where.action = action;
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;
  if (createdAt) where.createdAt = createdAt;

  const [count, rows] = await Promise.all([
    prisma.adminAuditLog.count({ where }),
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { [sortBy]: sortType },
      skip,
      take: limit,
      select: {
        id: true,
        actorRole: true,
        action: true,
        targetType: true,
        targetId: true,
        reason: true,
        metadata: true,
        ip: true,
        userAgent: true,
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
    action: "ADMIN_AUDIT_LOGS_READ",
    targetType: "ADMIN_AUDIT_LOG",
    metadata: {
      filters: {
        actorId: actorId || null,
        action: action || null,
        targetType: targetType || null,
        targetId: targetId || null,
        from: req.query.from || null,
        to: req.query.to || null,
      },
    },
  });

  const items = rows.map((row) => ({
    ...row,
    actor: toUserSummary(row.actor),
  }));

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "auditLogs",
        items,
        currentPage: page,
        limit,
        totalItems: count,
      }),
      "Admin audit logs fetched"
    )
  );
});

export const getAdminAuditLogById = asyncHandler(async (req, res) => {
  const logId = ensureRequiredId(req.params.logId, "logId");

  const row = await prisma.adminAuditLog.findUnique({
    where: { id: logId },
    select: {
      id: true,
      actorRole: true,
      action: true,
      targetType: true,
      targetId: true,
      reason: true,
      before: true,
      after: true,
      metadata: true,
      ip: true,
      userAgent: true,
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
  });

  if (!row) {
    return res.status(404).json({ success: false, message: "Audit log not found" });
  }

  await writeAdminAuditLog({
    req,
    actor: req.user,
    action: "ADMIN_AUDIT_LOG_READ",
    targetType: "ADMIN_AUDIT_LOG",
    targetId: row.id,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...row,
        actor: toUserSummary(row.actor),
      },
      "Admin audit log detail fetched"
    )
  );
});
