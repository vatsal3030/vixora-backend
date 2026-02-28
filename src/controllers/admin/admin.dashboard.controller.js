import prisma from "../../db/prisma.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import {
  buildAdminPermissions,
  buildRangeForDays,
  resolvePeriodOrThrow,
} from "../../services/admin.policy.service.js";
import {
  createDailyBuckets,
  dailyBucketToSeries,
  incrementDailyBucket,
} from "../../services/admin.controller.utils.js";

export const getAdminMe = asyncHandler(async (req, res) => {
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        admin: {
          id: req.user.id,
          fullName: req.user.fullName,
          username: req.user.username,
          email: req.user.email,
          avatar: req.user.avatar,
          role: req.user.role,
          moderationStatus: req.user.moderationStatus,
          createdAt: req.user.createdAt,
        },
        permissions: buildAdminPermissions(req.user.role),
      },
      "Admin profile fetched"
    )
  );
});

export const getAdminDashboardOverview = asyncHandler(async (req, res) => {
  const { period, days } = resolvePeriodOrThrow(req.query.period, "7d");
  const { start, end } = buildRangeForDays(days);

  const [
    usersTotal,
    activeUsers,
    restrictedUsers,
    suspendedUsers,
    videosTotal,
    shortsTotal,
    tweetsTotal,
    commentsTotal,
    playlistsTotal,
    reportsTotal,
    reportsPending,
    reportsInPeriod,
    reportActionsInPeriod,
    auditActionsInPeriod,
  ] = await Promise.all([
    prisma.user.count({ where: {} }),
    prisma.user.count({ where: { isDeleted: false } }),
    prisma.user.count({ where: { moderationStatus: "RESTRICTED", isDeleted: false } }),
    prisma.user.count({ where: { moderationStatus: "SUSPENDED", isDeleted: false } }),
    prisma.video.count({ where: { isDeleted: false, isShort: false } }),
    prisma.video.count({ where: { isDeleted: false, isShort: true } }),
    prisma.tweet.count({ where: { isDeleted: false } }),
    prisma.comment.count({ where: { isDeleted: false } }),
    prisma.playlist.count({ where: { isDeleted: false } }),
    prisma.report.count({ where: {} }),
    prisma.report.count({ where: { status: "PENDING" } }),
    prisma.report.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.report.count({ where: { status: "ACTION_TAKEN", updatedAt: { gte: start, lte: end } } }),
    prisma.adminAuditLog.count({ where: { createdAt: { gte: start, lte: end } } }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        period,
        dateRange: {
          from: start.toISOString(),
          to: end.toISOString(),
        },
        totals: {
          users: usersTotal,
          channels: usersTotal,
          activeUsers,
          restrictedUsers,
          suspendedUsers,
          videos: videosTotal,
          shorts: shortsTotal,
          tweets: tweetsTotal,
          comments: commentsTotal,
          playlists: playlistsTotal,
          reports: reportsTotal,
          reportsPending,
        },
        moderation: {
          reportsInPeriod,
          reportActionsInPeriod,
          adminActionsInPeriod: auditActionsInPeriod,
        },
      },
      "Admin dashboard overview fetched"
    )
  );
});

export const getAdminDashboardActivity = asyncHandler(async (req, res) => {
  const { period, days } = resolvePeriodOrThrow(req.query.period, "7d");
  const { start, end } = buildRangeForDays(days);

  const reportVolumeBucket = createDailyBuckets({ start, end });
  const actionTakenBucket = createDailyBuckets({ start, end });
  const restrictionsBucket = createDailyBuckets({ start, end });

  const [reports, actionReports, statusAudits] = await Promise.all([
    prisma.report.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.report.findMany({
      where: {
        status: "ACTION_TAKEN",
        updatedAt: { gte: start, lte: end },
      },
      select: { updatedAt: true },
      orderBy: { updatedAt: "asc" },
    }),
    prisma.adminAuditLog.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        action: {
          in: ["ADMIN_USER_STATUS_UPDATE", "ADMIN_USER_SOFT_DELETE"],
        },
      },
      select: {
        action: true,
        createdAt: true,
        after: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  for (const row of reports) {
    incrementDailyBucket(reportVolumeBucket, row.createdAt, 1);
  }

  for (const row of actionReports) {
    incrementDailyBucket(actionTakenBucket, row.updatedAt, 1);
  }

  for (const row of statusAudits) {
    if (row.action === "ADMIN_USER_SOFT_DELETE") {
      incrementDailyBucket(restrictionsBucket, row.createdAt, 1);
      continue;
    }

    const nextStatus =
      row.after && typeof row.after === "object"
        ? String(row.after.moderationStatus || "").toUpperCase()
        : "";

    if (["RESTRICTED", "SUSPENDED"].includes(nextStatus)) {
      incrementDailyBucket(restrictionsBucket, row.createdAt, 1);
    }
  }

  const reportVolumeSeries = dailyBucketToSeries(reportVolumeBucket);
  const actionTakenSeries = dailyBucketToSeries(actionTakenBucket);
  const restrictionsSeries = dailyBucketToSeries(restrictionsBucket);

  const sumSeries = (series) => series.reduce((acc, row) => acc + Number(row.value || 0), 0);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        period,
        dateRange: {
          from: start.toISOString(),
          to: end.toISOString(),
        },
        series: {
          reportVolume: reportVolumeSeries,
          actionsTaken: actionTakenSeries,
          accountRestrictions: restrictionsSeries,
        },
        totals: {
          reportVolume: sumSeries(reportVolumeSeries),
          actionsTaken: sumSeries(actionTakenSeries),
          accountRestrictions: sumSeries(restrictionsSeries),
        },
      },
      "Admin dashboard activity fetched"
    )
  );
});
