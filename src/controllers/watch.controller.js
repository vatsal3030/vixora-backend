import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

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


export const watchVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        include: {
            owner: {
                select: {
                    username: true,
                    avatar: true
                }
            }
        }
    });

    if (!video || !video.isPublished) {
        throw new ApiError(404, "Video not found")
    }

    // Increment views (simple version)
    await prisma.video.update({
        where: { id: videoId },
        data: { views: { increment: 1 }, shareCount: { increment: 1 } }
    });

    await updateVideoScore(videoId)

    return res.status(200).json(
        new ApiResponse(200, video, "Video Loaded successfully")
    )

});
