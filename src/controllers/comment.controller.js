import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import { sanitizePagination } from "../utils/pagination.js";
import { sanitizeSort } from "../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../utils/listResponse.js";
import { recordUserActivity } from "../services/user.activity.service.js";

const MAX_COMMENT_LENGTH = 1000;

const updateVideoScore = async (videoId) => {
    if (!videoId) return;

    const [video, likesCount, commentsCount, watchCount] = await Promise.all([
        prisma.video.findUnique({
            where: { id: videoId },
            select: { views: true },
        }),
        prisma.like.count({ where: { videoId } }),
        prisma.comment.count({ where: { videoId, isDeleted: false } }),
        prisma.watchHistory.count({ where: { videoId } }),
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
            engagementScore: score / 10,
        },
    });
};

const refreshVideoScoreInBackground = (videoId) => {
    void updateVideoScore(videoId).catch((error) => {
        console.error("Failed to update video score:", error?.message || error);
    });
};

export const getVideoComments = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    let {
        page = "1",
        limit = "10",
        sortType = "desc"
    } = req.query;

    const userId = req.user?.id; // OPTIONAL

    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);
    const safeSort = sanitizeSort("createdAt", sortType, ["createdAt"], "createdAt");
    sortType = safeSort.sortType;

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            isPublished: true,
            isDeleted: true,
            processingStatus: true,
            isHlsReady: true,
        }
    });

    if (
        !video ||
        !video.isPublished ||
        video.isDeleted
    ) {
        throw new ApiError(404, "Video not found");
    }

    const comments = await prisma.comment.findMany({
        where: {
            videoId,
            isDeleted: false,
            parentId: null,
        },
        orderBy: {
            createdAt: sortType,
        },
        skip,
        take: safeLimit,
        select: {
            id: true,
            content: true,
            createdAt: true,
            updatedAt: true,
            ownerId: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true,
                }
            },
            _count: {
                select: {
                    likes: true,
                    replies: true,
                }
            },
            likes: userId ? {
                where: { likedById: userId },
                select: { id: true }
            } : false,
            replies: {
                where: { isDeleted: false },
                orderBy: { createdAt: "asc" },
                select: {
                    id: true,
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                    ownerId: true,
                    owner: {
                        select: {
                            id: true,
                            username: true,
                            avatar: true,
                        }
                    },
                    _count: { select: { likes: true, replies: true } },
                    likes: userId ? { where: { likedById: userId }, select: { id: true } } : false,
                }
            }
        }
    });

    const totalComments = await prisma.comment.count({
        where: { videoId, isDeleted: false, parentId: null }
    });

    const formattedComments = comments.map((comment) => ({
        ...comment,
        likesCount: comment._count.likes,
        repliesCount: comment._count.replies,
        isLiked: userId ? comment.likes.length > 0 : false,
        _count: undefined,
        likes: undefined,
        replies: comment.replies.map(reply => ({
            ...reply,
            likesCount: reply._count.likes,
            repliesCount: reply._count.replies,
            isLiked: userId ? reply.likes.length > 0 : false,
            _count: undefined,
            likes: undefined,
        }))
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "comments",
                items: formattedComments,
                currentPage: safePage,
                limit: safeLimit,
                totalItems: totalComments,
                legacyTotalKey: "totalComments",
            }),
            "Comments fetched successfully"
        )
    );
});

// ✅ Get replies for a specific comment (supports deep nesting on demand)
export const getCommentReplies = asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    if (!commentId) {
        throw new ApiError(400, "Comment ID is required");
    }

    const userId = req.user?.id || null;
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(req.query?.page, req.query?.limit, 50);

    // Verify the parent comment exists
    const parentComment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: { id: true, isDeleted: true }
    });

    if (!parentComment) {
        throw new ApiError(404, "Comment not found");
    }

    const replies = await prisma.comment.findMany({
        where: {
            parentId: commentId,
            isDeleted: false,
        },
        orderBy: { createdAt: "asc" },
        skip,
        take: safeLimit,
        select: {
            id: true,
            content: true,
            createdAt: true,
            updatedAt: true,
            ownerId: true,
            parentId: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true,
                }
            },
            _count: {
                select: {
                    likes: true,
                    replies: true,
                }
            },
            likes: userId ? {
                where: { likedById: userId },
                select: { id: true }
            } : false,
        }
    });

    const totalReplies = await prisma.comment.count({
        where: { parentId: commentId, isDeleted: false }
    });

    const formattedReplies = replies.map((reply) => ({
        ...reply,
        likesCount: reply._count.likes,
        repliesCount: reply._count.replies,
        isLiked: userId ? reply.likes.length > 0 : false,
        _count: undefined,
        likes: undefined,
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "replies",
                items: formattedReplies,
                currentPage: safePage,
                limit: safeLimit,
                totalItems: totalReplies,
            }),
            "Replies fetched successfully"
        )
    );
});

export const addComment = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const userId = req.user?.id;
    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    const content = String(req.body?.content ?? "").trim();

    if (!content) {
        throw new ApiError(400, "Comment content cannot be empty");
    }

    if (content.length > MAX_COMMENT_LENGTH) {
        throw new ApiError(400, `Comment too long (max ${MAX_COMMENT_LENGTH})`);
    }

    // ✅ Check video existence
    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            isPublished: true,
            isDeleted: true,
            processingStatus: true,
            isHlsReady: true,
        },
    });

    if (
        !video ||
        !video.isPublished ||
        video.isDeleted
    ) {
        throw new ApiError(404, "Video not found");
    }

    // Verify parentId if passed
    let parentId = req.body?.parentId || null;
    if (parentId) {
        const parent = await prisma.comment.findUnique({
            where: { id: String(parentId) },
            select: { id: true, isDeleted: true }
        });
        if (!parent || parent.isDeleted) {
            parentId = null;
        }
    }

    // ✅ Create comment
    const comment = await prisma.comment.create({
        data: {
            content,
            ownerId: userId,
            videoId: videoId,
            parentId: parentId,
        },
        select: {
            id: true,
            content: true,
            createdAt: true,
            updatedAt: true,
            parentId: true,
            ownerId: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true,
                },
            },
        },
    });
    refreshVideoScoreInBackground(videoId);

    const formattedComment = {
        ...comment,
        likesCount: 0,
        repliesCount: 0,
        isLiked: false,
        replies: []
    };

    void recordUserActivity({
        req,
        userId,
        action: "COMMENT",
        targetType: "VIDEO",
        targetId: videoId,
        metadata: { commentId: comment.id, isReply: Boolean(comment.parentId) },
        dedupeMinutes: 0,
    });

    return res.status(201).json(
        new ApiResponse(201, formattedComment, "Comment added successfully")
    );
});


export const updateComment = asyncHandler(async (req, res) => {
    const { commentId } = req.params;

    if (!commentId) {
        throw new ApiError(400, "Comment ID is required");
    }

    const userId = req.user?.id;
    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    const content = String(req.body?.content ?? "").trim();

    if (!content) {
        throw new ApiError(400, "Comment content cannot be empty");
    }

    if (content.length > MAX_COMMENT_LENGTH) {
        throw new ApiError(400, `Comment too long (max ${MAX_COMMENT_LENGTH})`);
    }

    // ✅ Check comment existence + ownership
    const existingComment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: {
            id: true,
            ownerId: true,
            isDeleted: true,
        },
    });

    if (!existingComment || existingComment.isDeleted) {
        throw new ApiError(404, "Comment not found");
    }

    if (existingComment.ownerId !== userId) {
        throw new ApiError(403, "You are not allowed to update this comment");
    }

    // ✅ Update comment
    const updatedComment = await prisma.comment.update({
        where: { id: commentId },
        data: {
            content,
        },
        select: {
            id: true,
            content: true,
            updatedAt: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true,
                },
            },
        },
    });

    return res.status(200).json(
        new ApiResponse(200, updatedComment, "Comment updated successfully")
    );
});

export const deleteComment = asyncHandler(async (req, res) => {
    const { commentId } = req.params;

    if (!commentId) {
        throw new ApiError(400, "Comment ID is required");
    }

    const userId = req.user?.id;
    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    // ✅ Check comment existence + ownership
    const existingComment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: {
            id: true,
            ownerId: true,
            isDeleted: true,
            videoId: true,
        },
    });

    if (!existingComment) {
        throw new ApiError(404, "Comment not found");
    }

    if (existingComment.ownerId !== userId) {
        throw new ApiError(403, "You are not allowed to delete this comment");
    }

    if (existingComment.isDeleted) {
        return res.status(200).json(
            new ApiResponse(200, {}, "Comment deleted successfully")
        );
    }

    // ✅ Soft delete comment
    await prisma.comment.update({
        where: { id: commentId },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });
    if (existingComment.videoId) {
        refreshVideoScoreInBackground(existingComment.videoId);
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "Comment deleted successfully")
    );
});

// ✅ Get comments for a Tweet/Community post
export const getTweetComments = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    if (!tweetId) {
        throw new ApiError(400, "Tweet ID is required");
    }

    let {
        page = "1",
        limit = "10",
        sortType = "desc"
    } = req.query;

    const userId = req.user?.id;
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);
    const safeSort = sanitizeSort("createdAt", sortType, ["createdAt"], "createdAt");
    sortType = safeSort.sortType;

    const tweet = await prisma.tweet.findUnique({
        where: { id: tweetId },
        select: { id: true, isDeleted: true }
    });

    if (!tweet || tweet.isDeleted) {
        throw new ApiError(404, "Tweet / Post not found");
    }

    const comments = await prisma.comment.findMany({
        where: {
            tweetId,
            isDeleted: false,
            parentId: null,
        },
        orderBy: {
            createdAt: sortType,
        },
        skip,
        take: safeLimit,
        select: {
            id: true,
            content: true,
            createdAt: true,
            updatedAt: true,
            ownerId: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true,
                }
            },
            _count: {
                select: {
                    likes: true,
                    replies: true,
                }
            },
            likes: userId ? {
                where: { likedById: userId },
                select: { id: true }
            } : false,
            replies: {
                where: { isDeleted: false },
                orderBy: { createdAt: "asc" },
                select: {
                    id: true,
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                    ownerId: true,
                    parentId: true,
                    owner: {
                        select: {
                            id: true,
                            username: true,
                            avatar: true,
                        }
                    },
                    _count: { select: { likes: true, replies: true } },
                    likes: userId ? { where: { likedById: userId }, select: { id: true } } : false,
                }
            }
        }
    });

    const totalComments = await prisma.comment.count({
        where: { tweetId, isDeleted: false, parentId: null }
    });

    const formattedComments = comments.map((comment) => ({
        ...comment,
        likesCount: comment._count.likes,
        repliesCount: comment._count.replies,
        isLiked: userId ? comment.likes.length > 0 : false,
        _count: undefined,
        likes: undefined,
        replies: comment.replies.map(reply => ({
            ...reply,
            likesCount: reply._count.likes,
            repliesCount: reply._count.replies,
            isLiked: userId ? reply.likes.length > 0 : false,
            _count: undefined,
            likes: undefined,
        }))
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "comments",
                items: formattedComments,
                currentPage: safePage,
                limit: safeLimit,
                totalItems: totalComments,
                legacyTotalKey: "totalComments",
            }),
            "Tweet comments fetched successfully"
        )
    );
});

// ✅ Add comment to a Tweet/Community post
export const addTweetComment = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    if (!tweetId) {
        throw new ApiError(400, "Tweet ID is required");
    }

    const userId = req.user?.id;
    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    const content = String(req.body?.content ?? "").trim();

    if (!content) {
        throw new ApiError(400, "Comment content cannot be empty");
    }

    if (content.length > MAX_COMMENT_LENGTH) {
        throw new ApiError(400, `Comment too long (max ${MAX_COMMENT_LENGTH})`);
    }

    const tweet = await prisma.tweet.findUnique({
        where: { id: tweetId },
        select: {
            id: true,
            ownerId: true,
            isDeleted: true,
        },
    });

    if (!tweet || tweet.isDeleted) {
        throw new ApiError(404, "Tweet / Post not found");
    }

    let parentId = req.body?.parentId || null;
    if (parentId) {
        const parent = await prisma.comment.findUnique({
            where: { id: String(parentId) },
            select: { id: true, isDeleted: true }
        });
        if (!parent || parent.isDeleted) {
            parentId = null;
        }
    }

    const comment = await prisma.comment.create({
        data: {
            content,
            ownerId: userId,
            tweetId: tweetId,
            parentId: parentId,
        },
        select: {
            id: true,
            content: true,
            createdAt: true,
            updatedAt: true,
            parentId: true,
            ownerId: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true,
                },
            },
        },
    });

    const formattedComment = {
        ...comment,
        likesCount: 0,
        repliesCount: 0,
        isLiked: false,
        replies: []
    };

    void recordUserActivity({
        req,
        userId,
        action: "COMMENT",
        targetType: "TWEET",
        targetId: tweetId,
        metadata: { commentId: comment.id, isReply: Boolean(comment.parentId) },
        dedupeMinutes: 0,
    });

    return res.status(201).json(
        new ApiResponse(201, formattedComment, "Tweet comment added successfully")
    );
});
