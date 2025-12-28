import asyncHandler from "../utils/asyncHandler.js"
import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
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
    const video = await prisma.video.findUnique({
        where: { id: videoId },
        include: {
            likes: true,
            comments: true,
            watchHistory: true
        }
    });

    const score =
        video.views * 0.3 +
        video.likes.length * 0.4 +
        video.comments.length * 0.2 +
        video.watchHistory.length * 0.1;

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
        select: { id: true },
    });

    if (!video) {
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
        select: { id: true },
    });

    if (!comment) {
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

    // ✅ Check tweet existence
    const tweet = await prisma.tweet.findUnique({
        where: { id: tweetId },
        select: { id: true },
    });

    if (!tweet) {
        throw new ApiError(404, "Tweet not found");
    }

    // ✅ Check if like already exists
    const existingLike = await prisma.like.findUnique({
        where: {
            likedById_tweetId: {
                likedById: req.user.id,
                tweetId: tweetId,
            },
        },
    });

    // ✅ Toggle logic
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
            likedById: req.user.id,
            tweetId: tweetId,
        },
    });

    await updateVideoScore(videoId)


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
    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;
    sortType = sortType === "asc" ? "asc" : "desc";

    // ✅ Fetch liked videos (via likes table)
    const likedVideoLikes = await prisma.like.findMany({
        where: {
            likedById: req.user.id,
            videoId: {
                not: null, // ✅ only video likes
            },
        },
        orderBy: {
            createdAt: sortType, // liked time
        },
        skip,
        take: limit,
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
        },
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                videos,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalLikedVideos / limit),
                    totalLikedVideos,
                },
            },
            "Liked videos fetched successfully"
        )
    );
});

