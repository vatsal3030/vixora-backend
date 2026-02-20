import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import { sanitizePagination } from "../utils/pagination.js";
import { sanitizeSort } from "../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../utils/listResponse.js";

const MAX_COMMENT_LENGTH = 1000;

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
        video.isDeleted ||
        video.processingStatus !== "COMPLETED" ||
        !video.isHlsReady
    ) {
        throw new ApiError(404, "Video not found");
    }

    const comments = await prisma.comment.findMany({
        where: {
            videoId,
            isDeleted: false,
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
                }
            },
            likes: userId ? {
                where: { likedById: userId },
                select: { id: true }
            } : false,
        }
    });

    const totalComments = await prisma.comment.count({
        where: { videoId, isDeleted: false }
    });

    const formattedComments = comments.map((comment) => ({
        ...comment,
        likesCount: comment._count.likes,
        isLiked: userId ? comment.likes.length > 0 : false,
        _count: undefined,
        likes: undefined,
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
        video.isDeleted ||
        video.processingStatus !== "COMPLETED" ||
        !video.isHlsReady
    ) {
        throw new ApiError(404, "Video not found");
    }

    // ✅ Create comment
    const comment = await prisma.comment.create({
        data: {
            content,
            ownerId: userId,
            videoId: videoId,
        },
        select: {
            id: true,
            content: true,
            createdAt: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true,
                },
            },
        },
    });

    return res.status(201).json(
        new ApiResponse(201, comment, "Comment added successfully")
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

    return res.status(200).json(
        new ApiResponse(200, {}, "Comment deleted successfully")
    );
});
