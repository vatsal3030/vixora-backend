import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { sanitizePagination } from "../utils/pagination.js";
import { sanitizeSort } from "../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../utils/listResponse.js";

const parseBooleanQuery = (value) => {
  if (value === undefined || value === null || value === "") return undefined;

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  return undefined;
};

/**
 * Save or update watch progress
 */
export const saveWatchProgress = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { videoId } = req.body;
  let { progress, duration } = req.body;

  if (!videoId || progress === undefined || progress === null) {
    throw new ApiError(400, "Video ID and progress are required");
  }

  progress = Number(progress);
  const hasDurationInput =
    duration !== undefined && duration !== null && String(duration).trim() !== "";
  const requestedDuration = hasDurationInput ? Number(duration) : undefined;

  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new ApiError(400, "Progress must be between 0 and 100");
  }

  if (
    hasDurationInput &&
    (!Number.isFinite(requestedDuration) ||
      requestedDuration < 0 ||
      requestedDuration > 86400)
  ) {
    throw new ApiError(400, "Invalid duration value");
  }

  const [existingHistory, video] = await Promise.all([
    prisma.watchHistory.findUnique({
      where: {
        userId_videoId: { userId, videoId },
      },
      select: {
        duration: true,
      },
    }),
    prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        duration: true,
        isPublished: true,
        isDeleted: true,
        processingStatus: true,
        isHlsReady: true,
      },
    }),
  ]);

  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  if (
    !video.isPublished ||
    video.isDeleted ||
    video.processingStatus !== "COMPLETED" ||
    !video.isHlsReady
  ) {
    throw new ApiError(400, "Cannot track progress for unavailable video");
  }

  const completed = progress >= 95;
  const normalizedDuration = hasDurationInput
    ? requestedDuration
    : existingHistory?.duration ?? video.duration ?? 0;

  const result = await prisma.watchHistory.upsert({
    where: {
      userId_videoId: { userId, videoId },
    },
    update: {
      progress,
      duration: normalizedDuration,
      completed,
      lastWatchedAt: new Date(),
    },
    create: {
      userId,
      videoId,
      progress,
      duration: normalizedDuration,
      completed,
      lastWatchedAt: new Date(),
    },
  });

  return res.json(new ApiResponse(200, result, "Progress saved"));
});

/**
 * Get watch progress for a video
 */
export const getWatchProgress = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { videoId } = req.params;

  if (!videoId) {
    throw new ApiError(400, "Video ID is required");
  }

  const history = await prisma.watchHistory.findUnique({
    where: {
      userId_videoId: { userId, videoId },
    },
  });

  return res.json(new ApiResponse(200, history));
});

/**
 * Continue Watching list
 */
export const getContinueWatching = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  let {
    page = "1",
    limit = "10",
    query = "",
    isShort = "",
    includeCompleted = "false",
    sortBy = "updatedAt",
    sortType = "desc",
  } = req.query;

  const { page: safePage, limit: safeLimit, skip } = sanitizePagination(
    page,
    limit,
    50
  );

  const safeSort = sanitizeSort(
    sortBy,
    sortType,
    ["updatedAt", "createdAt", "lastWatchedAt"],
    "updatedAt"
  );
  sortBy = safeSort.sortBy;
  sortType = safeSort.sortType;

  const isShortFilter = parseBooleanQuery(isShort);
  const includeCompletedFilter = parseBooleanQuery(includeCompleted);
  const normalizedQuery = String(query || "").trim();

  const videoFilter = {
    isPublished: true,
    isDeleted: false,
    processingStatus: "COMPLETED",
    isHlsReady: true,
    ...(normalizedQuery && {
      title: {
        contains: normalizedQuery,
        mode: "insensitive",
      },
    }),
    ...(isShortFilter !== undefined && {
      isShort: isShortFilter,
    }),
  };

  const baseWhere = {
    userId,
    ...(includeCompletedFilter !== true && { completed: false }),
    video: {
      is: videoFilter,
    },
  };

  const [history, totalItems] = await Promise.all([
    prisma.watchHistory.findMany({
      where: baseWhere,
      orderBy: {
        [sortBy]: sortType,
      },
      skip,
      take: safeLimit,
      select: {
        progress: true,
        duration: true,
        completed: true,
        lastWatchedAt: true,
        updatedAt: true,
        video: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
            duration: true,
            views: true,
            createdAt: true,
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
    prisma.watchHistory.count({
      where: baseWhere,
    }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        items: history,
        currentPage: safePage,
        limit: safeLimit,
        totalItems,
        extra: {
          filters: {
            query: normalizedQuery,
            isShort: isShortFilter ?? null,
            includeCompleted: includeCompletedFilter === true,
          },
        },
      }),
      "Continue watching fetched successfully"
    )
  );
});

/**
 * Get watch progress for a list of video IDs (bulk)
 * POST /watch-history/bulk
 * body: { videoIds: ["id1","id2", ...] }
 */
export const getProgressForVideos = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.json(new ApiResponse(200, {}));
  }

  const { videoIds } = req.body;
  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return res.json(new ApiResponse(200, {}));
  }

  const MAX_IDS = 100;
  const ids = videoIds.slice(0, MAX_IDS);

  const rows = await prisma.watchHistory.findMany({
    where: {
      userId,
      videoId: { in: ids },
    },
    select: {
      videoId: true,
      progress: true,
      duration: true,
      completed: true,
      updatedAt: true,
    },
  });

  const map = {};
  for (const row of rows) {
    map[row.videoId] = {
      progress: row.progress,
      duration: row.duration,
      completed: row.completed,
      updatedAt: row.updatedAt,
    };
  }

  return res.json(new ApiResponse(200, map));
});
