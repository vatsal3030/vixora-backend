import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"

/**
 * Save or update watch progress
 */
export const saveWatchProgress = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let { videoId, progress, duration } = req.body;

  if (!videoId || progress === undefined || progress === null) {
    throw new ApiError(400, "Video ID and progress are required");
  }

  // ✅ Type coercion
  progress = Number(progress);
  duration = Number(duration || 0);

  // ✅ Validation
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new ApiError(400, "Progress must be between 0 and 100");
  }

  if (!Number.isFinite(duration) || duration < 0 || duration > 86400) {
    throw new ApiError(400, "Invalid duration value");
  }

  const videoExists = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true }
  });

  if (!videoExists) {
    throw new ApiError(404, "Video not found");
  }


  const completed = progress >= 95;

  const result = await prisma.watchHistory.upsert({
    where: {
      userId_videoId: { userId, videoId }
    },
    update: {
      progress,
      duration,
      completed,
      lastWatchedAt: new Date()
    },
    create: {
      userId,
      videoId,
      progress,
      duration,
      completed,
      lastWatchedAt: new Date()
    }
  });

  return res.json(new ApiResponse(200, result, "Progress saved"));
});

/**
 * Get watch progress for a video
 */
export const getWatchProgress = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { videoId } = req.params;

  const history = await prisma.watchHistory.findUnique({
    where: {
      userId_videoId: { userId, videoId }
    }
  });

  res.json(new ApiResponse(200, history));
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
    isShort = "false",
    sortBy = "updatedAt",
    sortType = "desc"
  } = req.query;

  // ------------------------
  // Pagination validation
  // ------------------------
  page = Number(page);
  limit = Number(limit);

  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

  const skip = (page - 1) * limit;

  // ------------------------
  // Sorting validation
  // ------------------------
  const allowedSortFields = ["updatedAt", "createdAt"];
  if (!allowedSortFields.includes(sortBy)) {
    sortBy = "updatedAt";
  }

  sortType = sortType === "asc" ? "asc" : "desc";

  // ------------------------
  // Build video filter correctly
  // ------------------------
  const videoFilter = {
    ...(query && {
      title: {
        contains: query,
        mode: "insensitive"
      }
    }),
    ...(isShort === "true" && {
      duration: { lte: 60 }
    })
  };

  // ------------------------
  // Fetch Watch History
  // ------------------------
  const history = await prisma.watchHistory.findMany({
    where: {
      userId,
      video: {
        is: videoFilter   // ✅ THIS IS THE FIX
      }
    },
    orderBy: {
      [sortBy]: sortType
    },
    skip,
    take: limit,
    select: {
      progress: true,
      duration: true,
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
              avatar: true
            }
          }
        }
      }
    }
  });


  const totalVideos = await prisma.watchHistory.count({
    where: {
      userId,
      video: {
        is: videoFilter
      }
    }
  });


  return res.status(200).json(
    new ApiResponse(
      200,
      {
        videos: history,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalVideos / limit),
          totalVideos
        }
      },
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
    // if unauthenticated, return empty (frontend should use localStorage)
    return res.json(new ApiResponse(200, {}));
  }

  const { videoIds } = req.body;
  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return res.json(new ApiResponse(200, {}));
  }

  // Safety: limit how many IDs you allow per request to avoid huge SQL IN lists
  const MAX_IDS = 100;
  const ids = videoIds.slice(0, MAX_IDS);

  const rows = await prisma.watchHistory.findMany({
    where: {
      userId,
      videoId: { in: ids }
    },
    select: {
      videoId: true,
      progress: true,
      duration: true,
      completed: true,
      updatedAt: true
    }
  });

  // Convert to map { videoId -> { progress, duration, ... } }
  const map = {};
  for (const r of rows) {
    map[r.videoId] = {
      progress: r.progress,
      duration: r.duration,
      completed: r.completed,
      updatedAt: r.updatedAt
    };
  }

  return res.json(new ApiResponse(200, map));
});






