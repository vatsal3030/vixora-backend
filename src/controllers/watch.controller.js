import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

const DEFAULT_VIDEO_SCORE_RECALC_VIEW_INTERVAL = 5;

const parsePositiveInt = (value, fallbackValue) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
};

const VIDEO_SCORE_RECALC_VIEW_INTERVAL = parsePositiveInt(
    process.env.VIDEO_SCORE_RECALC_VIEW_INTERVAL,
    DEFAULT_VIDEO_SCORE_RECALC_VIEW_INTERVAL
);

const shouldRecalculateVideoScore = (viewCount) =>
    viewCount === 1 || viewCount % VIDEO_SCORE_RECALC_VIEW_INTERVAL === 0;

export const updateVideoScore = async (videoId) => {
    const [video, likesCount, commentsCount, watchCount] = await Promise.all([
        prisma.video.findUnique({
            where: { id: videoId },
            select: { views: true }
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
            engagementScore: score / 10
        }
    });
};


export const watchVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const viewerId = req.user?.id || null;

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            title: true,
            description: true,
            thumbnail: true,
            duration: true,
            views: true,
            createdAt: true,
            playbackUrl: true,
            availableQualities: true,
            isShort: true,
            isPublished: true,
            isDeleted: true,
            processingStatus: true,
            isHlsReady: true,
            ownerId: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    fullName: true,
                    avatar: true,
                }
            }
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

    const isOwner = Boolean(viewerId && viewerId === video.ownerId);
    let resolvedViews = video.views;

    if (!viewerId || viewerId !== video.ownerId) {
        const updatedVideo = await prisma.video.update({
            where: { id: videoId },
            data: { views: { increment: 1 } },
            select: { views: true },
        });

        resolvedViews = updatedVideo.views;

        if (shouldRecalculateVideoScore(updatedVideo.views)) {
            updateVideoScore(videoId).catch((error) => {
                console.error("Failed to update video score:", error?.message || error);
            });
        }
    }

    return res.status(200).json(
        new ApiResponse(200, {
            id: video.id,
            title: video.title,
            description: video.description,
            thumbnail: video.thumbnail,
            duration: video.duration,
            views: resolvedViews,
            createdAt: video.createdAt,
            playbackUrl: video.playbackUrl || null,
            availableQualities: video.availableQualities,
            isShort: video.isShort,
            owner: video.owner,
            viewerContext: {
                isOwner,
            },
        }, "Video loaded successfully")
    )

});
