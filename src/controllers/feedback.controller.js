import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { sanitizePagination } from "../utils/pagination.js";
import { buildPaginatedListData } from "../utils/listResponse.js";

const REPORT_TARGET_TYPES = new Set(["VIDEO", "COMMENT", "USER", "CHANNEL"]);
const MAX_REPORT_REASON_LENGTH = 120;
const MAX_REPORT_DESCRIPTION_LENGTH = 2000;

const normalizeText = (value) => String(value ?? "").trim();

const validateReportTarget = async ({ targetType, targetId }) => {
  switch (targetType) {
    case "VIDEO": {
      const row = await prisma.video.findUnique({
        where: { id: targetId },
        select: { id: true, isDeleted: true },
      });
      return Boolean(row && !row.isDeleted);
    }
    case "COMMENT": {
      const row = await prisma.comment.findUnique({
        where: { id: targetId },
        select: { id: true, isDeleted: true },
      });
      return Boolean(row && !row.isDeleted);
    }
    case "USER":
    case "CHANNEL": {
      const row = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, isDeleted: true },
      });
      return Boolean(row && !row.isDeleted);
    }
    default:
      return false;
  }
};

export const markNotInterested = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const videoId = normalizeText(req.params?.videoId);
  const reason = normalizeText(req.body?.reason).slice(0, 300) || null;

  if (!videoId) throw new ApiError(400, "videoId is required");

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, isDeleted: true },
  });

  if (!video || video.isDeleted) {
    throw new ApiError(404, "Video not found");
  }

  const row = await prisma.notInterested.upsert({
    where: {
      userId_videoId: {
        userId,
        videoId,
      },
    },
    create: {
      userId,
      videoId,
      reason,
    },
    update: {
      reason,
    },
  });

  await prisma.userEvent.create({
    data: {
      userId,
      eventType: "NOT_INTERESTED",
      entityType: "VIDEO",
      entityId: videoId,
      metadata: reason ? { reason } : undefined,
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        id: row.id,
        userId: row.userId,
        videoId: row.videoId,
        reason: row.reason,
        createdAt: row.createdAt,
      },
      "Marked as not interested"
    )
  );
});

export const removeNotInterested = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const videoId = normalizeText(req.params?.videoId);
  if (!videoId) throw new ApiError(400, "videoId is required");

  await prisma.notInterested.deleteMany({
    where: { userId, videoId },
  });

  return res.status(200).json(
    new ApiResponse(200, {}, "Removed from not interested")
  );
});

export const listNotInterested = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { page, limit, skip } = sanitizePagination(req.query?.page, req.query?.limit, 50);

  const [totalItems, rows] = await Promise.all([
    prisma.notInterested.count({
      where: { userId },
    }),
    prisma.notInterested.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        video: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
            ownerId: true,
            owner: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatar: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    videoId: row.videoId,
    reason: row.reason,
    createdAt: row.createdAt,
    video: row.video,
  }));

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "notInterested",
        items,
        currentPage: page,
        limit,
        totalItems,
      }),
      "Not interested list fetched"
    )
  );
});

export const blockChannel = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const channelId = normalizeText(req.params?.channelId);
  if (!channelId) throw new ApiError(400, "channelId is required");

  if (channelId === userId) {
    throw new ApiError(400, "You cannot block your own channel");
  }

  const channel = await prisma.user.findUnique({
    where: { id: channelId },
    select: { id: true, isDeleted: true },
  });

  if (!channel || channel.isDeleted) {
    throw new ApiError(404, "Channel not found");
  }

  const row = await prisma.blockedChannel.upsert({
    where: {
      userId_channelId: {
        userId,
        channelId,
      },
    },
    create: {
      userId,
      channelId,
    },
    update: {},
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        id: row.id,
        userId: row.userId,
        channelId: row.channelId,
        createdAt: row.createdAt,
      },
      "Channel blocked from recommendations"
    )
  );
});

export const unblockChannel = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const channelId = normalizeText(req.params?.channelId);
  if (!channelId) throw new ApiError(400, "channelId is required");

  await prisma.blockedChannel.deleteMany({
    where: { userId, channelId },
  });

  return res.status(200).json(
    new ApiResponse(200, {}, "Channel unblocked")
  );
});

export const listBlockedChannels = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { page, limit, skip } = sanitizePagination(req.query?.page, req.query?.limit, 50);

  const [totalItems, rows] = await Promise.all([
    prisma.blockedChannel.count({
      where: { userId },
    }),
    prisma.blockedChannel.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        channel: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatar: true,
          },
        },
      },
    }),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    channelId: row.channelId,
    createdAt: row.createdAt,
    channel: row.channel,
  }));

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "blockedChannels",
        items,
        currentPage: page,
        limit,
        totalItems,
      }),
      "Blocked channels fetched"
    )
  );
});

export const createReport = asyncHandler(async (req, res) => {
  const reporterId = req.user.id;

  const targetType = normalizeText(req.body?.targetType).toUpperCase();
  const targetId = normalizeText(req.body?.targetId);
  const reason = normalizeText(req.body?.reason).slice(0, MAX_REPORT_REASON_LENGTH);
  const description =
    normalizeText(req.body?.description).slice(0, MAX_REPORT_DESCRIPTION_LENGTH) || null;

  if (!REPORT_TARGET_TYPES.has(targetType)) {
    throw new ApiError(400, "Invalid targetType");
  }

  if (!targetId) {
    throw new ApiError(400, "targetId is required");
  }

  if (!reason) {
    throw new ApiError(400, "reason is required");
  }

  const targetExists = await validateReportTarget({ targetType, targetId });
  if (!targetExists) {
    throw new ApiError(404, "Report target not found");
  }

  const existingPending = await prisma.report.findFirst({
    where: {
      reporterId,
      targetType,
      targetId,
      status: "PENDING",
    },
    select: { id: true, createdAt: true },
  });

  if (existingPending) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          id: existingPending.id,
          status: "PENDING",
          createdAt: existingPending.createdAt,
        },
        "Report already submitted and pending review"
      )
    );
  }

  const report = await prisma.report.create({
    data: {
      reporterId,
      targetType,
      targetId,
      reason,
      description,
    },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      reason: true,
      description: true,
      status: true,
      createdAt: true,
    },
  });

  await prisma.userEvent.create({
    data: {
      userId: reporterId,
      eventType: "REPORT",
      entityType: targetType === "CHANNEL" ? "CHANNEL" : "VIDEO",
      entityId: targetId,
      metadata: {
        reportId: report.id,
        targetType,
        reason,
      },
    },
  });

  return res.status(201).json(
    new ApiResponse(201, report, "Report submitted")
  );
});

export const listMyReports = asyncHandler(async (req, res) => {
  const reporterId = req.user.id;
  const { page, limit, skip } = sanitizePagination(req.query?.page, req.query?.limit, 50);

  const [totalItems, reports] = await Promise.all([
    prisma.report.count({
      where: { reporterId },
    }),
    prisma.report.findMany({
      where: { reporterId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        description: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
      },
    }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        key: "reports",
        items: reports,
        currentPage: page,
        limit,
        totalItems,
      }),
      "Reports fetched"
    )
  );
});
