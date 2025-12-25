import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError";
import ApiResponse from "../utils/ApiResponse";
import asyncHandler from "../utils/asyncHandler.js"

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

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;
    sortType = sortType === "asc" ? "asc" : "desc";

    const comments = await prisma.comment.findMany({
        where: {
            videoId
        },
        orderBy: {
            createdAt: sortType,
        },
        skip,
        take: limit,
        select: {
            id: true,
            content: true,
            createdAt: true,
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
            }
        }
    });

    const totalComments = await prisma.comment.count({
        where: { videoId }
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                comments,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalComments / limit),
                    totalComments,
                },
            },
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

    const { content } = req.body;

    if (!content || content.trim().length === 0) {
        throw new ApiError(400, "Comment content cannot be empty");
    }

    // ✅ Check video existence
    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { id: true },
    });

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    // ✅ Create comment
    const comment = await prisma.comment.create({
        data: {
            content: content.trim(),
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

    const { content } = req.body;

    if (!content || content.trim().length === 0) {
        throw new ApiError(400, "Comment content cannot be empty");
    }

    // ✅ Check comment existence + ownership
    const existingComment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: {
            id: true,
            ownerId: true,
        },
    });

    if (!existingComment) {
        throw new ApiError(404, "Comment not found");
    }

    if (existingComment.ownerId !== userId) {
        throw new ApiError(403, "You are not allowed to update this comment");
    }

    // ✅ Update comment
    const updatedComment = await prisma.comment.update({
        where: { id: commentId },
        data: {
            content: content.trim(),
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
        },
    });

    if (!existingComment) {
        throw new ApiError(404, "Comment not found");
    }

    if (existingComment.ownerId !== userId) {
        throw new ApiError(403, "You are not allowed to delete this comment");
    }

    // ✅ Delete comment
    await prisma.comment.delete({
        where: { id: commentId },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Comment deleted successfully")
    );
});
