import asyncHandler from "../utils/asyncHandler.js"
import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { sanitizePagination } from "../utils/pagination.js";
import { buildPaginatedListData } from "../utils/listResponse.js";
// import upd from "../utils/updateFeedScrore.js"

// 1. Get videoId from params
// 2. Get userId from req.user
// 3. Check video exists
// 4. Check if like already exists (likedById + videoId)
// 5. IF exists:
//       - delete the like
//       - return "unliked"
//    ELSE:
//       - create like
//       - return "liked"


export const updateVideoScore = async (videoId) => {

    if (!videoId) return;

    const [video, likesCount, commentsCount, watchCount] = await Promise.all([
        prisma.video.findUnique({
            where: { id: videoId },
            select: { views: true }
        }),
        prisma.like.count({ where: { videoId } }),
        prisma.comment.count({ where: { videoId, isDeleted: false } }),
        prisma.watchHistory.count({ where: { videoId } })
    ]);

    if (!video) return;

    const score =
        video.views * 0.3 +
        likesCount * 0.4 +
        commentsCount * 0.2 +
        watchCount * 0.1;

    await prisma.video.update({
        where: { id: videoId },
        data: {
            popularityScore: score,
            engagementScore: score / 10
        }
    });
};


export const toggleVideoLike = asyncHandler(async (req, res) => {
    const { videoId } = req.params
    //TODO: toggle like on video

    if (!videoId) {
        throw new ApiError(400, "video ID is required");
    }

    const userId = req.user?.id
    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            isPublished: true,
            isDeleted: true,
            processingStatus: true,
            isHlsReady: true
        },
    });

    if (
        !video ||
        !video.isPublished ||
        video.isDeleted ||
        video.processingStatus !== "COMPLETED" ||
        !video.isHlsReady
    ) {
        throw new ApiError(404, "Video not found");
    }

    const existingLike = await prisma.like.findUnique({
        where: {
            likedById_videoId: {
                likedById: req.user.id,
                videoId: videoId
            }
        }
    })

    if (existingLike) {
        await prisma.like.delete({
            where: {
                id: existingLike.id
            }
        })
        return res.status(200).json(
            new ApiResponse(200, { status: "unliked" }, "Video unliked")
        );
    }


    await prisma.like.create({
        data: {
            likedById: req.user.id,
            videoId: videoId
        }
    })

    await updateVideoScore(videoId)

    return res.status(201).json(
        new ApiResponse(201, { status: "liked" }, "Video liked")
    );

})

export const toggleCommentLike = asyncHandler(async (req, res) => {
    const { commentId } = req.params;

    if (!commentId) {
        throw new ApiError(400, "Comment ID is required");
    }

    const userId = req.user?.id;
    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    // ✅ Check comment existence
    const comment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: { id: true, isDeleted: true },
    });

    if (!comment || comment.isDeleted) {
        throw new ApiError(404, "Comment not found");
    }

    // ✅ Check existing like
    const existingLike = await prisma.like.findUnique({
        where: {
            likedById_commentId: {
                likedById: req.user.id,
                commentId: commentId,
            },
        },
    });

    // ✅ Toggle logic
    if (existingLike) {
        await prisma.like.delete({
            where: { id: existingLike.id },
        });

        return res.status(200).json(
            new ApiResponse(200, { status: "unliked" }, "Comment unliked")
        );
    }

    await prisma.like.create({
        data: {
            likedById: req.user.id,
            commentId: commentId,
        },
    });

    return res.status(201).json(
        new ApiResponse(201, { status: "liked" }, "Comment liked")
    );
});

export const toggleTweetLike = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    if (!tweetId) {
        throw new ApiError(400, "Tweet ID is required");
    }

    const userId = req.user?.id;
    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    const tweet = await prisma.tweet.findUnique({
        where: { id: tweetId },
        select: { id: true, isDeleted: true },
    });

    if (!tweet || tweet.isDeleted) {
        throw new ApiError(404, "Tweet not found");
    }

    const existingLike = await prisma.like.findUnique({
        where: {
            likedById_tweetId: {
                likedById: userId,
                tweetId: tweetId,
            },
        },
    });

    if (existingLike) {
        await prisma.like.delete({
            where: { id: existingLike.id },
        });

        return res.status(200).json(
            new ApiResponse(200, { status: "unliked" }, "Tweet unliked")
        );
    }

    await prisma.like.create({
        data: {
            likedById: userId,
            tweetId: tweetId,
        },
    });

    return res.status(201).json(
        new ApiResponse(201, { status: "liked" }, "Tweet liked")
    );
});

export const getLikedVideos = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "10",
        sortType = "desc"
    } = req.query;

    const userId = req.user?.id;
    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    // 🔢 Parse pagination
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);
    sortType = sortType === "asc" ? "asc" : "desc";

    // ✅ Fetch liked videos (via likes table)
    const likedVideoLikes = await prisma.like.findMany({
        where: {
            likedById: req.user.id,
            videoId: {
                not: null, // ✅ only video likes
            },
            video: {
                is: {
                    isPublished: true,
                    isDeleted: false,
                    processingStatus: "COMPLETED",
                    isHlsReady: true,
                }
            }
        },
        orderBy: {
            createdAt: sortType, // liked time
        },
        skip,
        take: safeLimit,
        select: {
            video: {
                select: {
                    id: true,
                    title: true,
                    description: true,
                    thumbnail: true,
                    duration: true,
                    views: true,
                    createdAt: true,
                    owner: {
                        select: {
                            id: true,
                            username: true,
                            avatar: true,
                        },
                    },
                },
            },
        },
    });

    // ✅ Flatten response
    const videos = likedVideoLikes
        .map(like => like.video)
        .filter(Boolean);

    // ✅ Total count (for pagination)
    const totalLikedVideos = await prisma.like.count({
        where: {
            likedById: req.user.id,
            videoId: {
                not: null,
            },
            video: {
                is: {
                    isPublished: true,
                    isDeleted: false,
                    processingStatus: "COMPLETED",
                    isHlsReady: true,
                }
            }
        },
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "videos",
                items: videos,
                currentPage: safePage,
                limit: safeLimit,
                totalItems: totalLikedVideos,
                legacyTotalKey: "totalLikedVideos",
            }),
            "Liked videos fetched successfully"
        )
    );
});

