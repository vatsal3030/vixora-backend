import prisma from "../../db/prisma.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { sanitizePagination } from "../../utils/pagination.js";
import { sanitizeSort } from "../../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../../utils/listResponse.js";
import { writeAdminAuditLog } from "../../services/admin.audit.service.js";
import { adminBaseUserSelect, adminModeratedBySelect } from "../../services/admin.selects.js";
import {
  MAX_ADMIN_LIST_LIMIT,
  ensureRequiredId,
  normalizeOptionalText,
  normalizeText,
  parseBoolQuery,
  toUserSummary,
} from "../../services/admin.controller.utils.js";
import { TOP_ADMIN_ROLE } from "../../config/admin.config.js";
import {
  runAdminUserRestore,
  runAdminUserSoftDelete,
  runAdminUserStatusUpdate,
  runAdminVerifyPendingEmail,
} from "../../services/admin.userModeration.service.js";

export const getAdminUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = sanitizePagination(
    req.query.page,
    req.query.limit,
    MAX_ADMIN_LIST_LIMIT
  );

  const allowedSortFields = [
    "createdAt",
    "updatedAt",
    "fullName",
    "username",
    "email",
    "role",
    "moderationStatus",
  ];

  const { sortBy, sortType } = sanitizeSort(
    normalizeText(req.query.sortBy || "createdAt"),
    normalizeText(req.query.sortType || "desc"),
    allowedSortFields,
    "createdAt"
  );

  const q = normalizeText(req.query.q).slice(0, 120);
  const role = normalizeText(req.query.role).toUpperCase();
  const moderationStatus = normalizeText(req.query.status).toUpperCase();
  const isDeleted = parseBoolQuery(req.query.isDeleted);

  const where = {};

  if (role) {
    if (!["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN"].includes(role)) {
      throw new ApiError(400, "Invalid role filter");
    }
    where.role = role;
  }

  if (moderationStatus) {
    if (!["ACTIVE", "RESTRICTED", "SUSPENDED"].includes(moderationStatus)) {
      throw new ApiError(400, "Invalid status filter");
    }
    where.moderationStatus = moderationStatus;
  }

  if (typeof isDeleted === "boolean") {
    where.isDeleted = isDeleted;
  }

  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { fullName: { contains: q, mode: "insensitive" } },
      { username: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const [count, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { [sortBy]: sortType },
      skip,
      take: limit,
      select: {
        ...adminBaseUserSelect,
        moderatedBy: {
          select: adminModeratedBySelect,
        },
        _count: {
          select: {
            subscribers: true,
            videos: true,
            tweets: true,
            comments: true,
            playlists: true,
          },
        },
      },
    }),
  ]);

  const normalized = items.map((row) => ({
    ...row,
    moderatedBy: toUserSummary(row.moderatedBy),
    stats: {
      subscribers: row._count.subscribers,
      videos: row._count.videos,
      tweets: row._count.tweets,
      comments: row._count.comments,
      playlists: row._count.playlists,
    },
    _count: undefined,
  }));

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "users",
        items: normalized,
        currentPage: page,
        limit,
        totalItems: count,
      }),
      "Admin users fetched"
    )
  );
});

export const getAdminUserById = asyncHandler(async (req, res) => {
  const userId = ensureRequiredId(req.params.userId, "userId");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...adminBaseUserSelect,
      moderatedBy: {
        select: adminModeratedBySelect,
      },
      _count: {
        select: {
          subscribers: true,
          subscriptions: true,
          videos: true,
          tweets: true,
          comments: true,
          playlists: true,
          reportsMade: true,
        },
      },
    },
  });

  if (!user) throw new ApiError(404, "User not found");

  await writeAdminAuditLog({
    req,
    actor: req.user,
    action: "ADMIN_USER_READ",
    targetType: "USER",
    targetId: user.id,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...user,
        moderatedBy: toUserSummary(user.moderatedBy),
        stats: {
          subscribers: user._count.subscribers,
          subscriptions: user._count.subscriptions,
          videos: user._count.videos,
          tweets: user._count.tweets,
          comments: user._count.comments,
          playlists: user._count.playlists,
          reportsMade: user._count.reportsMade,
        },
        _count: undefined,
      },
      "Admin user detail fetched"
    )
  );
});

export const updateAdminUserStatus = asyncHandler(async (req, res) => {
  const userId = ensureRequiredId(req.params.userId, "userId");

  const updated = await runAdminUserStatusUpdate({
    req,
    actor: req.user,
    userId,
    status: req.body?.status,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res
    .status(200)
    .json(new ApiResponse(200, updated, "User moderation status updated"));
});

export const verifyAdminPendingEmail = asyncHandler(async (req, res) => {
  const userId = ensureRequiredId(req.params.userId, "userId");

  const updated = await runAdminVerifyPendingEmail({
    req,
    actor: req.user,
    userId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res
    .status(200)
    .json(new ApiResponse(200, updated, "Pending email verified and promoted"));
});

export const softDeleteAdminUser = asyncHandler(async (req, res) => {
  const userId = ensureRequiredId(req.params.userId, "userId");

  const updated = await runAdminUserSoftDelete({
    req,
    actor: req.user,
    userId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "User soft deleted"));
});

export const restoreAdminUser = asyncHandler(async (req, res) => {
  const userId = ensureRequiredId(req.params.userId, "userId");

  const updated = await runAdminUserRestore({
    req,
    actor: req.user,
    userId,
    reason: normalizeOptionalText(req.body?.reason, 500),
  });

  return res.status(200).json(new ApiResponse(200, updated, "User restored"));
});

export const updateAdminUserRole = asyncHandler(async (req, res) => {
  const userId = ensureRequiredId(req.params.userId, "userId");
  const nextRole = normalizeText(req.body?.role).toUpperCase();

  if (!["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN"].includes(nextRole)) {
    throw new ApiError(400, "Invalid role");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...adminBaseUserSelect,
    },
  });

  if (!target) throw new ApiError(404, "User not found");

  if (target.role === TOP_ADMIN_ROLE && nextRole !== TOP_ADMIN_ROLE) {
    const superAdminCount = await prisma.user.count({
      where: {
        role: TOP_ADMIN_ROLE,
        isDeleted: false,
      },
    });

    if (superAdminCount <= 1) {
      throw new ApiError(400, "Cannot demote the last SUPER_ADMIN");
    }
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      role: nextRole,
    },
    select: {
      ...adminBaseUserSelect,
    },
  });

  await writeAdminAuditLog({
    req,
    actor: req.user,
    action: "ADMIN_USER_ROLE_UPDATE",
    targetType: "USER",
    targetId: target.id,
    reason: normalizeOptionalText(req.body?.reason, 500),
    before: { role: target.role },
    after: { role: updated.role },
  });

  return res.status(200).json(new ApiResponse(200, updated, "User role updated"));
});
