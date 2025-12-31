import prisma from "../db/prisma.js";
import asyncHandler from "../utils/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import ApiError from "../utils/ApiError.js";


/**
 * Helper: attach watch progress
 */
export const attachWatchProgress = async (videos, userId) => {
    if (!Array.isArray(videos)) {
        throw new ApiError(500, "Invalid video list provided to attachWatchProgress");
    }

    if (!userId || videos.length === 0) {
        return videos;
    }

    const videoIds = videos.map(v => v.id).filter(Boolean);

    if (videoIds.length === 0) return videos;

    const history = await prisma.watchHistory.findMany({
        where: {
            userId,
            videoId: { in: videoIds }
        },
        select: {
            videoId: true,
            progress: true,
            duration: true,
            completed: true
        }
    });

    const progressMap = {};
    for (const row of history) {
        progressMap[row.videoId] = {
            progress: row.progress,
            duration: row.duration,
            completed: row.completed
        };
    }

    return videos.map(video => ({
        ...video,
        watchProgress: progressMap[video.id] || null
    }));


};

/**
 * HOME FEED
 * Mix of recent + popular videos
 */
export const getHomeFeed = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "10",
        sortBy = "createdAt",
        sortType = "desc"
    } = req.query;

    const userId = req.user?.id || null;

    // -------------------------------
    // Pagination validation
    // -------------------------------
    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    // -------------------------------
    // Sorting validation
    // -------------------------------
    const allowedSortFields = ["createdAt", "views"];
    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "createdAt";
    }

    sortType = sortType === "asc" ? "asc" : "desc";

    // -------------------------------
    // Base filter
    // -------------------------------
    const whereClause = {
        isPublished: true
    };

    // -------------------------------
    // Fetch videos
    // -------------------------------

    const watchedVideoTags = await prisma.watchHistory.findMany({
        where: { userId },
        select: {
            video: {
                select: {
                    tags: { select: { tagId: true } }
                }
            }
        }
    });

    const interestedTagIds = [
        ...new Set(
            watchedVideoTags.flatMap(v =>
                v.video.tags.map(t => t.tagId)
            )
        )
    ];

    const subscriptions = await prisma.subscription.findMany({
        where: { subscriberId: userId },
        select: { channelId: true }
    });

    const subscribedChannelIds = subscriptions.map(s => s.channelId);



    const videos = await prisma.video.findMany({
        where: {
            isPublished: true,
            OR: [
                { ownerId: { in: subscribedChannelIds } },
                { tags: { some: { tagId: { in: interestedTagIds } } } }
            ]
        },
        orderBy: [
            { popularityScore: "desc" },
            { createdAt: "desc" }
        ],
        skip,
        take: limit,
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
                    avatar: true
                }
            }
        }
    });

    if (videos.length === 0) {
        videos = await prisma.video.findMany({
            where: { isPublished: true },
            orderBy: { views: "desc" },
            take: limit
        });
    }


    // -------------------------------
    // Attach watch progress
    // -------------------------------
    const videosWithProgress = await attachWatchProgress(videos, userId);

    // -------------------------------
    // Total count for pagination
    // -------------------------------
    const totalVideos = await prisma.video.count({
        where: whereClause
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                videos: videosWithProgress,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalVideos / limit),
                    totalVideos
                }
            },
            "Home feed fetched successfully"
        )
    );
});


/**
 * SUBSCRIPTIONS FEED
 */
export const getSubscriptionsFeed = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    let {
        page = "1",
        limit = "10",
        isShort = "false"
    } = req.query;

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    // Convert isShort safely
    const isShortFilter =
        isShort === "true" ? true :
            isShort === "false" ? false :
                undefined;

    // 1️⃣ Get subscribed channels
    const subscriptions = await prisma.subscription.findMany({
        where: { subscriberId: userId },
        select: { channelId: true }
    });

    if (!subscriptions.length) {
        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    videos: [],
                    pagination: {
                        currentPage: page,
                        totalPages: 0,
                        totalVideos: 0
                    }
                },
                "No subscriptions found"
            )
        );
    }

    const channelIds = subscriptions.map(s => s.channelId);

    // 2️⃣ Build video filter
    const videoWhere = {
        ownerId: { in: channelIds },
        isPublished: true,
        ...(isShortFilter !== undefined && { isShort: isShortFilter })
    };

    // 3️⃣ Fetch videos
    const videos = await prisma.video.findMany({
        where: videoWhere,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
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
                    avatar: true
                }
            }
        }
    });

    // 4️⃣ Attach watch progress
    const videosWithProgress = await attachWatchProgress(videos, userId);

    // 5️⃣ Total count
    const totalVideos = await prisma.video.count({
        where: videoWhere
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                videos: videosWithProgress,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalVideos / limit),
                    totalVideos
                }
            },
            "Subscription feed fetched successfully"
        )
    );
});

/**
 * TRENDING FEED
 */
export const getTrendingFeed = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "20",
        isShort = "false"
    } = req.query;

    // --------------------------
    // Pagination
    // --------------------------
    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 20;

    const skip = (page - 1) * limit;

    // --------------------------
    // Boolean conversion
    // --------------------------
    const isShortFilter =
        isShort === "true" ? true :
            isShort === "false" ? false :
                undefined;

    // --------------------------
    // Where clause
    // --------------------------
    const whereClause = {
        isPublished: true,
        ...(isShortFilter !== undefined && { isShort: isShortFilter })
    };

    // --------------------------
    // Fetch videos
    // --------------------------
    const videos = await prisma.video.findMany({
        where: whereClause,
        orderBy: [
            { views: "desc" },
            { createdAt: "desc" }
        ],
        skip,
        take: limit,
        select: {
            id: true,
            title: true,
            thumbnail: true,
            duration: true,
            views: true,
            createdAt: true,
            isShort: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true
                }
            }
        }
    });

    // --------------------------
    // Total count
    // --------------------------
    const totalVideos = await prisma.video.count({
        where: whereClause
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                videos,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalVideos / limit),
                    totalVideos
                }
            },
            "Trending feed fetched successfully"
        )
    );
});


/**
 * SHORTS FEED
 */
export const getShortsFeed = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "20"
    } = req.query;

    const userId = req.user?.id || null;

    // Pagination safety
    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 20;

    const skip = (page - 1) * limit;

    // Fetch shorts
    const shorts = await prisma.video.findMany({
        where: {
            isShort: true,
            isPublished: true
        },
        orderBy: {
            createdAt: "desc"
        },
        skip,
        take: limit,
        select: {
            id: true,
            title: true,
            description: true,
            thumbnail: true,
            videoFile: true,
            duration: true,
            views: true,
            createdAt: true,
            owner: {
                select: {
                    id: true,
                    fullName: true,
                    username: true,
                    avatar: true
                }
            }
        }
    });

    // Attach watch progress
    const shortsWithProgress = await attachWatchProgress(shorts, userId);

    // Count for pagination
    const totalShorts = await prisma.video.count({
        where: {
            isShort: true,
            isPublished: true
        }
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                shorts: shortsWithProgress,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalShorts / limit),
                    totalShorts
                }
            },
            "Shorts feed fetched successfully"
        )
    );
});

