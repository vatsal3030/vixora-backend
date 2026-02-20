import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { buildVideoStreamingPayload } from "../utils/videoQuality.js";
import { buildPaginatedListData } from "../utils/listResponse.js";
import {
    filterTranscriptSegments,
    parseTimeQueryToMs,
    resolveTranscriptForRead,
} from "../utils/transcript.js";

const DEFAULT_VIDEO_SCORE_RECALC_VIEW_INTERVAL = 5;

const parsePositiveInt = (value, fallbackValue) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
};

const parseNonNegativeNumber = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
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
    const { quality } = req.query;
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
            videoFile: true,
            playbackUrl: true,
            masterPlaylistUrl: true,
            availableQualities: true,
            isShort: true,
            isPublished: true,
            isDeleted: true,
            processingStatus: true,
            isHlsReady: true,
            ownerId: true,
            transcript: {
                select: {
                    language: true,
                    wordCount: true,
                    updatedAt: true,
                },
            },
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
    const streaming = buildVideoStreamingPayload({
        sourceUrl: video.videoFile,
        playbackUrl: video.masterPlaylistUrl || video.playbackUrl,
        availableQualities: video.availableQualities,
        requestedQuality: quality,
    });

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
            playbackUrl: streaming.selectedPlaybackUrl,
            availableQualities: streaming.availableQualities,
            selectedQuality: streaming.selectedQuality,
            qualityUrls: streaming.qualityUrls,
            streaming: {
                defaultQuality: streaming.defaultQuality,
                selectedQuality: streaming.selectedQuality,
                selectedPlaybackUrl: streaming.selectedPlaybackUrl,
                masterPlaylistUrl: streaming.masterPlaylistUrl,
                availableQualities: streaming.availableQualities,
            },
            isShort: video.isShort,
            owner: video.owner,
            viewerContext: {
                isOwner,
            },
            transcript: {
                hasTranscript: Boolean(video.transcript),
                language: video.transcript?.language || null,
                wordCount: video.transcript?.wordCount || 0,
                updatedAt: video.transcript?.updatedAt || null,
            },
        }, "Video loaded successfully")
    )

});

export const getVideoTranscript = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const viewerId = req.user?.id || null;
    const query = String(req.query?.q || "").trim();
    const fromMs = parseTimeQueryToMs(req.query?.from) ??
        (parseNonNegativeNumber(req.query?.fromSeconds) !== null
            ? Math.floor(Number(req.query.fromSeconds) * 1000)
            : null);
    const toMs = parseTimeQueryToMs(req.query?.to) ??
        (parseNonNegativeNumber(req.query?.toSeconds) !== null
            ? Math.floor(Number(req.query.toSeconds) * 1000)
            : null);

    const page = parsePositiveInt(req.query?.page, 1);
    const limit = parsePositiveInt(req.query?.limit, 50);
    const safeLimit = Math.min(limit, 200);

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            title: true,
            ownerId: true,
            duration: true,
            isPublished: true,
            isDeleted: true,
            processingStatus: true,
            isHlsReady: true,
            transcript: {
                select: {
                    transcript: true,
                    segments: true,
                    language: true,
                    source: true,
                    wordCount: true,
                    updatedAt: true,
                },
            },
        },
    });

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    const isOwner = Boolean(viewerId && viewerId === video.ownerId);

    if (
        video.isDeleted ||
        video.processingStatus !== "COMPLETED" ||
        !video.isHlsReady
    ) {
        throw new ApiError(404, "Video not ready");
    }

    if (!video.isPublished && !isOwner) {
        throw new ApiError(403, "This video is not published");
    }

    const transcriptRecord = video.transcript;

    if (!transcriptRecord) {
        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    videoId: video.id,
                    title: video.title,
                    hasTranscript: false,
                    items: [],
                    pagination: {
                        currentPage: page,
                        page,
                        itemsPerPage: safeLimit,
                        limit: safeLimit,
                        totalItems: 0,
                        total: 0,
                        totalPages: 0,
                        hasPrevPage: false,
                        hasNextPage: false,
                    },
                },
                "Transcript not available"
            )
        );
    }

    const transcriptData = resolveTranscriptForRead({
        transcript: transcriptRecord.transcript,
        segments: transcriptRecord.segments,
        durationSeconds: video.duration,
    });

    const filteredSegments = filterTranscriptSegments({
        segments: transcriptData.segments,
        query,
        fromMs,
        toMs,
    });

    const skip = (page - 1) * safeLimit;
    const pagedItems = filteredSegments.slice(skip, skip + safeLimit);

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "segments",
                items: pagedItems,
                currentPage: page,
                limit: safeLimit,
                totalItems: filteredSegments.length,
                extra: {
                    videoId: video.id,
                    title: video.title,
                    hasTranscript: true,
                    transcript: transcriptData.transcriptText,
                    language: transcriptRecord.language || null,
                    source: transcriptRecord.source || null,
                    wordCount: transcriptRecord.wordCount ?? transcriptData.wordCount,
                    transcriptUpdatedAt: transcriptRecord.updatedAt,
                    filters: {
                        q: query || null,
                        fromMs,
                        toMs,
                    },
                },
            }),
            "Transcript fetched"
        )
    );
});
