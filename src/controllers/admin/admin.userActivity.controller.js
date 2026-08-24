import prisma from "../../db/prisma.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { sanitizePagination } from "../../utils/pagination.js";
import { sanitizeSort } from "../../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../../utils/listResponse.js";
import {
  getDateRangeFilter,
  MAX_ADMIN_LIST_LIMIT,
  normalizeText,
  toUserSummary,
  ensureRequiredId,
} from "../../services/admin.controller.utils.js";
import { resolvePeriodOrThrow, buildRangeForDays } from "../../services/admin.policy.service.js";
import { createDailyBuckets, dailyBucketToSeries, incrementDailyBucket } from "../../services/admin.controller.utils.js";

export const getAdminUserActivities = asyncHandler(async (req, res) => {
  const { page, limit, skip } = sanitizePagination(req.query.page, req.query.limit, MAX_ADMIN_LIST_LIMIT);

  const { sortBy, sortType } = sanitizeSort(
    normalizeText(req.query.sortBy || "createdAt"),
    normalizeText(req.query.sortType || "desc"),
    ["createdAt", "action", "targetType"],
    "createdAt"
  );

  const where = {};

  const userId = normalizeText(req.query.userId);
  const action = normalizeText(req.query.action)?.toUpperCase();
  const targetType = normalizeText(req.query.targetType)?.toUpperCase();
  const targetId = normalizeText(req.query.targetId);
  const search = normalizeText(req.query.search);
  const createdAt = getDateRangeFilter(req.query);

  if (userId) where.userId = userId;
  if (action) where.action = action;
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;
  if (createdAt) where.createdAt = createdAt;

  if (search) {
    where.OR = [
      { user: { username: { contains: search, mode: "insensitive" } } },
      { user: { fullName: { contains: search, mode: "insensitive" } } },
      { user: { email: { contains: search, mode: "insensitive" } } },
      { action: { contains: search, mode: "insensitive" } },
    ];
  }

  const [count, rows] = await Promise.all([
    prisma.userActivityLog.count({ where }),
    prisma.userActivityLog.findMany({
      where,
      orderBy: { [sortBy]: sortType },
      skip,
      take: limit,
      select: {
        id: true,
        userId: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        user: {
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

  const items = rows.map((row) => ({
    ...row,
    user: toUserSummary(row.user),
  }));

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "activities",
        items,
        currentPage: page,
        limit,
        totalItems: count,
      }),
      "User activities fetched"
    )
  );
});

export const getAdminUserActivityStats = asyncHandler(async (req, res) => {
  const { period, days } = resolvePeriodOrThrow(req.query.period, "7d");
  const { start, end } = buildRangeForDays(days);

  const wherePeriod = {
    createdAt: { gte: start, lte: end },
  };

  const [totalActions, actionsGrouped, topUsersGrouped, timelineRows] = await Promise.all([
    prisma.userActivityLog.count({ where: wherePeriod }),
    prisma.userActivityLog.groupBy({
      by: ["action"],
      where: wherePeriod,
      _count: { action: true },
      orderBy: { _count: { action: "desc" } },
    }),
    prisma.userActivityLog.groupBy({
      by: ["userId"],
      where: wherePeriod,
      _count: { userId: true },
      orderBy: { _count: { userId: "desc" } },
      take: 5,
    }),
    prisma.userActivityLog.findMany({
      where: wherePeriod,
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Fetch user profiles for top active users
  const topUserIds = topUsersGrouped.map((u) => u.userId);
  const topUsersDetails = topUserIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: topUserIds } },
        select: {
          id: true,
          fullName: true,
          username: true,
          avatar: true,
          role: true,
        },
      })
    : [];

  const userMap = new Map(topUsersDetails.map((u) => [u.id, toUserSummary(u)]));
  const topActiveUsers = topUsersGrouped.map((u) => ({
    user: userMap.get(u.userId) || { id: u.userId, username: "unknown" },
    actionCount: u._count.userId,
  }));

  // Timeline buckets
  const activityBucket = createDailyBuckets({ start, end });
  for (const row of timelineRows) {
    incrementDailyBucket(activityBucket, row.createdAt, 1);
  }
  const activitySeries = dailyBucketToSeries(activityBucket);

  const actionBreakdown = actionsGrouped.map((item) => ({
    action: item.action,
    count: item._count.action,
  }));

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        period,
        dateRange: {
          from: start.toISOString(),
          to: end.toISOString(),
        },
        totalActions,
        actionBreakdown,
        topActiveUsers,
        activityTimeline: activitySeries,
      },
      "User activity statistics fetched"
    )
  );
});
