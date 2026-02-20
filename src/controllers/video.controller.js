import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import { getCachedValue, setCachedValue } from "../utils/cache.js";
import { buildPaginatedListData } from "../utils/listResponse.js";
import { buildVideoStreamingPayload } from "../utils/videoQuality.js";
import {
    ChannelNotificationAudience,
    dispatchChannelActivityNotification,
} from "../services/notification.service.js";

const VIDEO_DETAIL_CACHE_TTL_SECONDS = 20;
const MAX_VIDEO_TITLE_LENGTH = 120;
const MAX_VIDEO_DESCRIPTION_LENGTH = 5000;

const dispatchNotificationInBackground = (payload) => {
    void dispatchChannelActivityNotification(payload).catch((error) => {
        console.error(
            "Notification dispatch failed:",
            error?.message || error
        );
    });
};


export const updateVideoScore = async (videoId) => {
    const video = await prisma.video.findUnique({
        where: { id: videoId },
        include: {
            likes: true,
            comments: true,
            watchHistory: true
        }
    });

    if (!video) return;

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

export const getAllVideos = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "10",
        query = "",
        sortBy = "createdAt",
        sortType = "desc",
        isShort = "false",
        tags = ""
    } = req.query;

    const userId = req.user?.id; // Get current user ID for progress

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    const whereClause = {
        isPublished: true,
        processingStatus: "COMPLETED",
        isHlsReady: true,
        isDeleted: false,
    };

    if (isShort !== undefined) {
        whereClause.isShort = isShort === "true";
    }

    // 🔍 Search filters
    if (query && query.trim().length > 0) {
        whereClause.OR = [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } }
        ];
    }

    // 🔖 Tag filter
    if (tags) {
        const tagArray = tags.split(",").map(t => t.trim().toLowerCase());
        whereClause.tags = {
            some: {
                tag: {
                    name: { in: tagArray }
                }
            }
        };
    }

    const allowedSortFields = ["createdAt", "views", "duration", "title"];

    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "createdAt";
    }

    sortType = sortType === "asc" ? "asc" : "desc";

    // 🔥 APPLY SCORE ONLY WHEN SEARCH EXISTS
    let videos;
    let totalCount;

    if (!query || query.trim() === "") {
        // ✅ DATABASE-LEVEL PAGINATION WITH PROGRESS
        [videos, totalCount] = await Promise.all([
            prisma.video.findMany({
                where: whereClause,
                skip,
                take: limit,
                orderBy: {
                    [sortBy]: sortType
                },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    thumbnail: true,
                    views: true,
                    duration: true,
            isPublished: true,
            createdAt: true,
                    playbackUrl: true,
                    availableQualities: true,
                    processingStatus: true,
                    processingProgress: true,
                    owner: {
                        select: {
                            id: true,
                            username: true,
                            fullName: true,
                            avatar: true
                        }
                    },
                    // Include watch progress for current user
                    ...(userId && {
                        watchHistory: {
                            where: { userId },
                            select: {
                                progress: true,
                                duration: true,
                                lastWatchedAt: true
                            }
                        }
                    })
                }
            }),
            prisma.video.count({ where: whereClause })
        ]);
    } else {
        // 🔥 SEARCH MODE (in-memory scoring) WITH PROGRESS
        const allVideos = await prisma.video.findMany({
            where: whereClause,
            orderBy: { views: "desc" }, // DB pre ranking
            take: limit * 5, // small buffer
            select: {
                id: true,
                title: true,
                description: true,
                thumbnail: true,
                views: true,
                duration: true,
            isPublished: true,
            createdAt: true,
                playbackUrl: true,
                availableQualities: true,
                processingStatus: true,
                processingProgress: true,
                owner: {
                    select: {
                        id: true,
                        username: true,
                        fullName: true,
                        avatar: true
                    }
                },
                // Include watch progress for current user
                ...(userId && {
                    watchHistory: {
                        where: { userId },
                        select: {
                            progress: true,
                            duration: true,
                            lastWatchedAt: true
                        }
                    }
                })
            }
        });

        const q = query.toLowerCase();

        const scored = allVideos.map(v => {
            let score = 0;
            if (v.title.toLowerCase().includes(q)) score += 5;
            if (v.description?.toLowerCase().includes(q)) score += 3;
            score += Math.min(v.views / 100, 5);
            const age = (Date.now() - new Date(v.createdAt)) / 86400000;
            score += Math.max(0, 5 - age);

            return { ...v, score };
        });

        scored.sort((a, b) => b.score - a.score);

        totalCount = scored.length;
        videos = scored.slice(skip, skip + limit);
    }

    // Transform videos to include progress data
    const videosWithProgress = videos.map(video => {
        const progress = video.watchHistory?.[0];
        return {
            ...video,
            progress: progress ? {
                watchedDuration: Math.round((progress.progress / 100) * progress.duration) || 0,
                percentage: progress.progress || 0,
                lastWatchedAt: progress.lastWatchedAt
            } : null,
            watchHistory: undefined // Remove from response
        };
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "videos",
                items: videosWithProgress,
                currentPage: page,
                limit,
                totalItems: totalCount,
                legacyTotalKey: "totalVideos",
            }),
            "Videos fetched successfully"
        )
    );
});

export const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { quality } = req.query;
    const userId = req.user?.id || null;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const cacheParams = {
        videoId,
        viewerId: userId || "anonymous",
        quality: String(quality || "auto").toLowerCase(),
    };

    const cached = await getCachedValue({
        scope: "video:detail",
        params: cacheParams,
    });

    if (cached.hit && cached.value?.data) {
        const cachedVideo = cached.value.data;

        if (cachedVideo?.owner?.id && cachedVideo.owner.id !== userId) {
            await prisma.video.update({
                where: { id: videoId },
                data: { views: { increment: 1 } }
            }).catch(() => null);
        }

        return res.status(200).json(
            new ApiResponse(200, cachedVideo, cached.value.message || "Video fetched successfully")
        );
    }

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            title: true,
            description: true,
            videoFile: true,
            thumbnail: true,
            duration: true,
            views: true,
            createdAt: true,
            playbackUrl: true,
            masterPlaylistUrl: true,
            availableQualities: true,
            processingProgress: true,
            processingStatus: true,
            isHlsReady: true,
            isDeleted: true,
            isPublished: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    fullName: true,
                    avatar: true,
                    _count: {
                        select: {
                            subscribers: true
                        }
                    }
                }
            },
            _count: {
                select: {
                    likes: true,
                    comments: true
                }
            },
            likes: userId ? {
                where: { likedById: userId },
                select: { id: true }
            } : false,
            tags: {
                select: {
                    tag: {
                        select: { name: true }
                    }
                }
            },
            transcript: {
                select: {
                    language: true,
                    wordCount: true,
                    updatedAt: true,
                },
            }
        }
    });

    if (
        !video ||
        video.isDeleted ||
        video.processingStatus !== "COMPLETED" ||
        !video.isHlsReady
    ) {
        throw new ApiError(404, "Video not found");
    }


    // 🔐 Access control
    const isOwner = Boolean(userId && video.owner.id === userId);
    if (!video.isPublished && !isOwner) {
        throw new ApiError(403, "This video is not published");
    }

    // Check if user is subscribed to channel
    let isSubscribed = false;
    if (userId && !isOwner) {
        const subscription = await prisma.subscription.findUnique({
            where: {
                subscriberId_channelId: {
                    subscriberId: userId,
                    channelId: video.owner.id
                }
            }
        });
        isSubscribed = !!subscription;
    }

    // 👁️ Increase view count (only if viewer is not owner)
    if (!isOwner) {
        await prisma.video.update({
            where: { id: videoId },
            data: { views: { increment: 1 } }
        });
    }

    // Format response with interaction data
    const formattedVideo = {
        ...video,
        playbackUrl: video.playbackUrl || video.videoFile,
        likesCount: video._count.likes,
        commentsCount: video._count.comments,
        isLiked: userId ? video.likes.length > 0 : false,
        owner: {
            ...video.owner,
            subscribersCount: video.owner._count.subscribers,
            isSubscribed,
            _count: undefined
        },
        tags: video.tags.map(t => t.tag.name),
        transcript: {
            hasTranscript: Boolean(video.transcript),
            language: video.transcript?.language || null,
            wordCount: video.transcript?.wordCount || 0,
            updatedAt: video.transcript?.updatedAt || null,
        },
        _count: undefined,
        likes: undefined,
    };

    const streaming = buildVideoStreamingPayload({
        sourceUrl: video.videoFile,
        playbackUrl: video.masterPlaylistUrl || video.playbackUrl,
        availableQualities: video.availableQualities,
        requestedQuality: quality,
    });

    formattedVideo.playbackUrl = streaming.selectedPlaybackUrl;
    formattedVideo.masterPlaylistUrl = streaming.masterPlaylistUrl;
    formattedVideo.availableQualities = streaming.availableQualities;
    formattedVideo.selectedQuality = streaming.selectedQuality;
    formattedVideo.qualityUrls = streaming.qualityUrls;
    formattedVideo.streaming = {
        defaultQuality: streaming.defaultQuality,
        selectedQuality: streaming.selectedQuality,
        selectedPlaybackUrl: streaming.selectedPlaybackUrl,
        masterPlaylistUrl: streaming.masterPlaylistUrl,
        availableQualities: streaming.availableQualities,
    };


    const responseMessage = "Video fetched successfully";

    await setCachedValue({
        scope: "video:detail",
        params: cacheParams,
        value: { data: formattedVideo, message: responseMessage },
        ttlSeconds: VIDEO_DETAIL_CACHE_TTL_SECONDS,
    });

    return res.status(200).json(
        new ApiResponse(200, formattedVideo, responseMessage)
    );
});

export const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { title, description } = req.body;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const hasTitle = title !== undefined;
    const hasDescription = description !== undefined;

    // Metadata-only updates.
    if (!hasTitle && !hasDescription) {
        throw new ApiError(400, "At least one field is required");
    }

    const normalizedTitle = hasTitle ? String(title ?? "").trim() : undefined;
    const normalizedDescription = hasDescription ? String(description ?? "").trim() : undefined;

    if (hasTitle && !normalizedTitle) {
        throw new ApiError(400, "Title cannot be empty");
    }

    if (normalizedTitle && normalizedTitle.length > MAX_VIDEO_TITLE_LENGTH) {
        throw new ApiError(400, `Title too long (max ${MAX_VIDEO_TITLE_LENGTH})`);
    }

    if (
        normalizedDescription !== undefined &&
        normalizedDescription.length > MAX_VIDEO_DESCRIPTION_LENGTH
    ) {
        throw new ApiError(
            400,
            `Description too long (max ${MAX_VIDEO_DESCRIPTION_LENGTH})`
        );
    }

    const existingVideo = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            ownerId: true,
            title: true,
            isShort: true,
            processingStatus: true,
            isHlsReady: true,
            isDeleted: true,
            isPublished: true,
        }
    });

    if (!existingVideo) throw new ApiError(404, "Video not found");

    if (existingVideo.ownerId !== req.user.id) {
        throw new ApiError(403, "Not allowed");
    }

    if (existingVideo.isDeleted) {
        throw new ApiError(400, "Restore video before editing");
    }

    if (existingVideo.processingStatus !== "COMPLETED" || !existingVideo.isHlsReady) {
        throw new ApiError(400, "Video still processing");
    }

    const updateData = {};

    if (normalizedTitle !== undefined) updateData.title = normalizedTitle;
    if (normalizedDescription !== undefined) updateData.description = normalizedDescription;

    // 🖼️ Thumbnail update
    const updatedVideo = await prisma.video.update({
        where: { id: videoId },
        data: updateData,
        select: {
            id: true,
            title: true,
            description: true,
            thumbnail: true,
            duration: true,
            views: true,
            isPublished: true,
            createdAt: true,
            isShort: true,
            aspectRatio: true,
            playbackUrl: true,
            availableQualities: true,
            processingStatus: true,
            processingProgress: true,
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

    if (existingVideo.isPublished) {
        const channelName =
            updatedVideo.owner?.fullName ||
            updatedVideo.owner?.username ||
            "A channel you follow";

        dispatchNotificationInBackground({
            channelId: existingVideo.ownerId,
            senderId: existingVideo.ownerId,
            activityType: "VIDEO_UPDATED",
            audience: ChannelNotificationAudience.ALL_ONLY,
            title: "Video updated",
            message: `${channelName} updated "${updatedVideo.title || existingVideo.title}"`,
            videoId: updatedVideo.id,
            extraData: {
                channelName,
                isShort: Boolean(updatedVideo.isShort ?? existingVideo.isShort),
                videoTitle: updatedVideo.title || existingVideo.title,
            },
        });
    }

    if (updatedVideo.isShort) {
        return res.status(200).json(
            new ApiResponse(200, updatedVideo, "Short details updated successfully")
        );
    }

    return res.status(200).json(
        new ApiResponse(200, updatedVideo, "Video details updated successfully")
    );
});

export const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            ownerId: true,
            processingStatus: true,
            isHlsReady: true,
            isDeleted: true,
            isPublished: true,
        },
    });

    if (!video) throw new ApiError(404, "Video not found");

    if (video.ownerId !== req.user.id) {
        throw new ApiError(403, "Not allowed");
    }

    if (video.isDeleted) {
        throw new ApiError(400, "Already deleted");
    }

    if (video.processingStatus !== "COMPLETED" || !video.isHlsReady) {
        throw new ApiError(400, "Video still processing");
    }

    await prisma.video.update({
        where: { id: videoId },
        data: {
            isDeleted: true,
            isPublished: false,
            deletedAt: new Date(),
        },
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Video deleted. You can restore it within 7 days."
        )
    );
});

export const getAllDeletedVideos = asyncHandler(async (req, res) => {
    let { page = "1", limit = "10", sortBy = "createdAt", sortType = "desc", isShort } = req.query;

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    const whereClause = {
        ownerId: req.user.id,
        isDeleted: true,
        deletedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
        processingStatus: "COMPLETED",
        isHlsReady: true,
    };

    if (isShort !== undefined) {
        whereClause.isShort = isShort === "true";
    }

    const allowedSortFields = ["createdAt", "views", "duration"];

    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "createdAt";
    }

    const videos = await prisma.video.findMany({
        where: whereClause,
        orderBy: {
            [sortBy]: sortType === "asc" ? "asc" : "desc",
        },
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
            aspectRatio: true,
            deletedAt: true,
            playbackUrl: true,
            availableQualities: true,
            processingStatus: true,
            processingProgress: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true
                }
            },
            tags: {
                select: {
                    tag: {
                        select: { name: true }
                    }
                }
            }
        }
    });

    const formattedVideos = videos.map(video => ({
        ...video,
        tags: video.tags.map(t => t.tag.name)
    }));

    const totalVideos = await prisma.video.count({
        where: whereClause,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "videos",
                items: formattedVideos,
                currentPage: page,
                limit,
                totalItems: totalVideos,
                legacyTotalKey: "totalVideos",
            }),
            "Videos fetched successfully"
        )
    );
});

export const restoreVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) throw new ApiError(400, "Video ID required");

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            ownerId: true,
            isDeleted: true,
            deletedAt: true
        }
    });

    if (!video) throw new ApiError(404, "Video not found");

    if (video.ownerId !== req.user.id) {
        throw new ApiError(403, "Not allowed");
    }

    if (!video.isDeleted) {
        throw new ApiError(400, "Video is not deleted");
    }

    if (video.deletedAt) {
        const restoreDeadline =
            video.deletedAt.getTime() + 7 * 24 * 60 * 60 * 1000;

        if (Date.now() > restoreDeadline) {
            throw new ApiError(403, "Restore window expired");
        }
    }

    const updated = await prisma.video.update({
        where: { id: videoId },
        data: {
            isDeleted: false,
            deletedAt: null
        }
    });

    return res.json(new ApiResponse(200, updated, "Video restored"));
});


export const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            ownerId: true,
            title: true,
            isShort: true,
            isDeleted: true,
            isPublished: true,
            processingStatus: true,
            isHlsReady: true,
            owner: {
                select: {
                    fullName: true,
                    username: true,
                },
            },
        }
    });

    if (!video) throw new ApiError(404, "Video not found");

    if (video.ownerId !== req.user.id) {
        throw new ApiError(403, "Not allowed");
    }

    if (video.isDeleted) {
        throw new ApiError(400, "Restore video first");
    }

    if (video.processingStatus !== "COMPLETED" || !video.isHlsReady) {
        throw new ApiError(400, "Video not ready yet");
    }

    const updated = await prisma.video.update({
        where: { id: videoId },
        data: { isPublished: !video.isPublished },
        select: { id: true, isPublished: true }
    });

    if (updated.isPublished) {
        const channelName =
            video.owner?.fullName ||
            video.owner?.username ||
            "A channel you follow";

        dispatchNotificationInBackground({
            channelId: video.ownerId,
            senderId: video.ownerId,
            activityType: video.isShort ? "SHORT_PUBLISHED" : "VIDEO_PUBLISHED",
            audience: ChannelNotificationAudience.ALL_AND_PERSONALIZED,
            title: video.isShort ? "New short uploaded" : "New video uploaded",
            message: `${channelName} uploaded "${video.title}"`,
            videoId: video.id,
            extraData: {
                channelName,
                isShort: video.isShort,
                videoTitle: video.title,
            },
        });
    }

    return res.json(
        new ApiResponse(
            200,
            updated,
            updated.isPublished ? "Video published" : "Video unpublished"
        )
    );
});


export const getUserVideos = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    let { page = "1", limit = "10", query = "", sortBy = "createdAt", sortType = "desc", isShort } = req.query;

    if (!userId) {
        throw new ApiError(400, "User ID is required");
    }

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    const whereClause = {
        ownerId: userId,
        isPublished: true,
        isDeleted: false,
        isHlsReady: true,
        processingStatus: "COMPLETED",
    };

    if (query && query.trim().length > 0) {
        whereClause.title = {
            contains: query,
            mode: "insensitive",
        };
    }

    if (isShort !== undefined) {
        whereClause.isShort = isShort === "true";
    }

    const allowedSortFields = ["createdAt", "views", "duration", "title"];

    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "createdAt";
    }

    const videos = await prisma.video.findMany({
        where: whereClause,
        orderBy: {
            [sortBy]: sortType === "asc" ? "asc" : "desc",
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
            isShort: true,
            createdAt: true,
            playbackUrl: true,
            availableQualities: true,
            processingStatus: true,
            processingProgress: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    fullName: true,
                    avatar: true,
                },
            },
        },
    });

    const totalVideos = await prisma.video.count({
        where: whereClause,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "videos",
                items: videos,
                currentPage: page,
                limit,
                totalItems: totalVideos,
                legacyTotalKey: "totalVideos",
            }),
            "User videos fetched successfully"
        )
    );
});

export const getMyVideos = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "10",
        query = "",
        isShort = "false",
        includeUnpublished = "true",
        sortBy = "createdAt",
        sortType = "desc",
        tags = ""
    } = req.query;

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    const userId = req.user?.id
    if (!userId) throw new ApiError(401, "Unauthorized");
    // ✅ Base filter
    const whereClause = {
        ownerId: userId,
        isDeleted: false,
        isHlsReady: true,
        processingStatus: "COMPLETED",
    };

    if (String(includeUnpublished).toLowerCase() !== "true") {
        whereClause.isPublished = true;
    }


    // 🔍 Search by title / description
    if (query && query.trim().length > 0) {
        whereClause.OR = [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } }
        ];
    }

    // 🔖 Tag filtering (comma separated)
    if (tags) {
        const tagArray = tags
            .split(",")
            .map(t => t.trim().toLowerCase())
            .filter(Boolean);


        whereClause.tags = {
            some: {
                tag: {
                    name: { in: tagArray }
                }
            }
        };
    }

    // Sorting
    const allowedSortFields = ["createdAt", "views", "title"];
    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "createdAt";
    }

    sortType = sortType === "asc" ? "asc" : "desc";

    if (isShort !== undefined) {
        whereClause.isShort = isShort === "true";
    }


    const allPublishedVideos = await prisma.video.findMany({
        where: whereClause,
        orderBy: {
            [sortBy]: sortType
        },
        skip,
        take: limit,
        select: {
            id: true,
            title: true,
            thumbnail: true,
            views: true,
            duration: true,
            isPublished: true,
            createdAt: true,
            playbackUrl: true,
            availableQualities: true,
            processingStatus: true,
            processingProgress: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true
                }
            }
        }
    });

    const totalVideos = await prisma.video.count({
        where: whereClause
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "videos",
                items: allPublishedVideos,
                currentPage: page,
                limit,
                totalItems: totalVideos,
                legacyTotalKey: "totalVideos",
            }),
            "My videos fetched successfully"
        )
    );
});





