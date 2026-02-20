import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import { getOrCreateWatchLater } from "../utils/getOrCreateWatchLaterPlaylist.js";
import { sanitizePagination } from "../utils/pagination.js";
import { buildPaginatedListData } from "../utils/listResponse.js";

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const MAX_PLAYLIST_NAME_LENGTH = 100;
const MAX_PLAYLIST_DESCRIPTION_LENGTH = 1000;

const WATCH_LATER_NAME = "Watch Later";

const isWatchLater = (playlist) => playlist.name === WATCH_LATER_NAME;
const normalizeText = (value) => String(value ?? "").trim();
const normalizeBoolean = (value, fallback = false) => {
    if (typeof value === "boolean") return value;
    if (value === undefined || value === null || value === "") return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return fallback;
};


export const createPlaylist = asyncHandler(async (req, res) => {
    const { name, description, isPublic = false } = req.body
    const normalizedName = normalizeText(name);
    const normalizedDescription = normalizeText(description);
    const normalizedIsPublic = normalizeBoolean(isPublic, false);

    if (!normalizedName) {
        throw new ApiError(400, "Playlist name is required");
    }

    if (normalizedName.length > MAX_PLAYLIST_NAME_LENGTH) {
        throw new ApiError(400, `Playlist name too long (max ${MAX_PLAYLIST_NAME_LENGTH})`);
    }

    if (normalizedDescription.length > MAX_PLAYLIST_DESCRIPTION_LENGTH) {
        throw new ApiError(
            400,
            `Playlist description too long (max ${MAX_PLAYLIST_DESCRIPTION_LENGTH})`
        );
    }

    if (normalizedName.toLowerCase() === WATCH_LATER_NAME.toLowerCase()) {
        throw new ApiError(400, "This playlist name is reserved");
    }

    const existing = await prisma.playlist.findFirst({
        where: {
            ownerId: req.user.id,
            name: {
                equals: normalizedName,
                mode: "insensitive",
            },
            isDeleted: false,
        },
    });

    if (existing) {
        throw new ApiError(409, "Playlist with this name already exists");
    }


    const playlist = await prisma.playlist.create({
        data: {
            name: normalizedName,
            description: normalizedDescription,
            isPublic: normalizedIsPublic,
            ownerId: req.user.id,
        },
    });

    return res.status(201).json(
        new ApiResponse(201, playlist, "Playlist created successfully")
    );

})

export const getUserPlaylists = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    let {
        page = "1",
        limit = "10",
        query = "",
        sortBy = "lastVideoAddedAt",
        sortType = "desc",
    } = req.query;

    if (!userId) {
        throw new ApiError(400, "User ID is required");
    }

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    // ✅ ALLOWED SORT FIELDS (security)
    const allowedSortFields = [
        "createdAt",
        "updatedAt",
        "lastVideoAddedAt",
        "name",
    ];
    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "lastVideoAddedAt";
        sortType = "desc";
    }

    const isSelf = req.user.id === userId;


    const whereClause = {
        ownerId: userId,
        isDeleted: false, // ✅ FIX: exclude deleted playlists
        ...(isSelf ? {} : { isPublic: true, NOT: { name: WATCH_LATER_NAME } }),
    };

    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 0) {
        whereClause.name = {
            contains: trimmedQuery,
            mode: "insensitive",
        };
    }

    const playlists = await prisma.playlist.findMany({
        where: whereClause,
        orderBy: {
            [sortBy]: sortType === "asc" ? "asc" : "desc",
        },
        skip,
        take: limit,
        select: {
            id: true,
            name: true,
            isPublic: true,
            videoCount: true,
            totalDuration: true,
            lastVideoAddedAt: true,
            createdAt: true,
            updatedAt: true,
            videos: {
                take: 1,
                orderBy: {
                    createdAt: "desc", // 🔥 latest-added video
                },
                select: {
                    video: {
                        select: {
                            thumbnail: true,
                        },
                    },
                },
            },
        },
    });

    const totalPlaylists = await prisma.playlist.count({
        where: whereClause,
    });

    const formattedPlaylists = playlists.map(p => ({
        id: p.id,
        name: p.name,
        isPublic: p.isPublic,
        videoCount: p.videoCount,
        totalDuration: p.totalDuration,
        updatedAt: p.updatedAt,
        thumbnail: p.videos[0]?.video.thumbnail || null,
        isWatchLater: p.name === WATCH_LATER_NAME,
    }));


    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "playlists",
                items: formattedPlaylists,
                currentPage: page,
                limit,
                totalItems: totalPlaylists,
                legacyTotalKey: "totalPlaylists",
            }),
            "Playlists fetched successfully"
        )
    );
});
export const getPlaylistById = asyncHandler(async (req, res) => {
    const { playlistId } = req.params;
    const { page = "1", limit = "50" } = req.query;

    if (!playlistId) {
        throw new ApiError(400, "playlistId is required");
    }

    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 100);

    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: {
            id: true,
            name: true,
            description: true,
            isPublic: true,
            isDeleted: true,
            ownerId: true,
            videoCount: true,
            totalDuration: true,
            createdAt: true,
            updatedAt: true,
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

    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    const isOwner = playlist.ownerId === req.user.id;

    if (playlist.isDeleted && !isOwner) {
        throw new ApiError(404, "Playlist not found");
    }

    if (!playlist.isPublic && !isOwner) {
        throw new ApiError(403, "This playlist is private");
    }

    const videoVisibilityWhere = isOwner
        ? { isDeleted: false }
        : {
            isDeleted: false,
            isPublished: true,
            processingStatus: "COMPLETED",
            isHlsReady: true,
        };

    const playlistVideos = await prisma.playlistVideo.findMany({
        where: {
            playlistId,
            video: videoVisibilityWhere,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: safeLimit,
        select: {
            video: {
                select: {
                    id: true,
                    title: true,
                    thumbnail: true,
                    duration: true,
                    views: true,
                    owner: {
                        select: {
                            id: true,
                            username: true,
                        },
                    },
                },
            },
        },
    });

    const visibleVideoCount = await prisma.playlistVideo.count({
        where: {
            playlistId,
            video: videoVisibilityWhere,
        },
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            (() => {
                const payload = buildPaginatedListData({
                    key: "videos",
                    items: playlistVideos.map(v => v.video),
                    currentPage: safePage,
                    limit: safeLimit,
                    totalItems: visibleVideoCount,
                    legacyTotalKey: "totalVideos",
                    extra: {
                        id: playlist.id,
                        name: playlist.name,
                        description: playlist.description,
                        isPublic: playlist.isPublic,
                        isDeleted: playlist.isDeleted,
                        isWatchLater: playlist.name === WATCH_LATER_NAME,
                        createdAt: playlist.createdAt,
                        updatedAt: playlist.updatedAt,
                        videoCount: visibleVideoCount,
                        savedVideoCount: playlist.videoCount,
                        totalDuration: playlist.totalDuration,
                        owner: playlist.owner,
                    },
                });
                payload.pagination.hasMore = payload.pagination.hasNextPage;
                return payload;
            })(),
            "Playlist fetched successfully"
        )
    );
});

export const addVideoToPlaylist = asyncHandler(async (req, res) => {
    const { videoId, playlistId } = req.params;

    if (!playlistId || !videoId) {
        throw new ApiError(400, "playlistId and videoId are required");
    }

    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: {
            id: true,
            ownerId: true,
            isDeleted: true,
            name: true,
            videos: {
                where: { videoId },
                select: { videoId: true },
            },
        },
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    if (playlist.isDeleted) {
        throw new ApiError(404, "Playlist not found");
    }

    if (playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to modify this playlist");
    }

    if (isWatchLater(playlist)) {
        throw new ApiError(403, "Use Watch Later toggle API");
    }

    const videoExists = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            duration: true,
            ownerId: true,
            isDeleted: true,
            isPublished: true,
            processingStatus: true,
            isHlsReady: true,
        },
    });

    if (!videoExists) {
        throw new ApiError(404, "Video not found");
    }

    if (videoExists.isDeleted) {
        throw new ApiError(404, "Video not found");
    }

    const canAccessVideo =
        videoExists.ownerId === req.user.id ||
        (videoExists.isPublished &&
            videoExists.processingStatus === "COMPLETED" &&
            videoExists.isHlsReady);

    if (!canAccessVideo) {
        throw new ApiError(403, "Video is not available");
    }

    if (playlist.videos.length > 0) {
        return res
            .status(200)
            .json(new ApiResponse(200, {}, "Video already in playlist"));
    }

    // ✅ CORRECT WAY
    await prisma.$transaction(async (tx) => {
        await tx.playlistVideo.create({
            data: { playlistId, videoId },
        });

        await tx.playlist.update({
            where: { id: playlistId },
            data: {
                videoCount: { increment: 1 },
                totalDuration: { increment: videoExists.duration },
                lastVideoAddedAt: new Date(),
            },
        });
    });


    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Video added to playlist"));
});

export const removeVideoFromPlaylist = asyncHandler(async (req, res) => {
    const { videoId, playlistId } = req.params;

    if (!playlistId || !videoId) {
        throw new ApiError(400, "playlistId and videoId are required");
    }

    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: {
            id: true,
            ownerId: true,
            isDeleted: true,
            name: true,
            videos: {
                where: { videoId },
                select: { videoId: true },
            },
        },
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    if (playlist.isDeleted) {
        throw new ApiError(404, "Playlist not found");
    }


    if (playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to modify this playlist");
    }

    if (playlist.videos.length === 0) {
        return res
            .status(200)
            .json(new ApiResponse(200, {}, "Video is not in this playlist"));
    }

    // ✅ CORRECT: delete junction row
    await prisma.$transaction(async (tx) => {
        const video = await tx.video.findUnique({
            where: { id: videoId },
            select: { duration: true },
        });

        if (!video) {
            throw new ApiError(404, "Video not found");
        }

        // Delete junction row
        await tx.playlistVideo.delete({
            where: { playlistId_videoId: { playlistId, videoId } },
        });

        // Find new latest video (if any)
        const lastVideo = await tx.playlistVideo.findFirst({
            where: { playlistId },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
        });

        await tx.playlist.update({
            where: { id: playlistId },
            data: {
                videoCount: { decrement: 1 },
                totalDuration: { decrement: video.duration },
                lastVideoAddedAt: lastVideo?.createdAt ?? null,
            },
        });
    });



    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Video removed from playlist"));
});

export const deletePlaylist = asyncHandler(async (req, res) => {
    const { playlistId } = req.params;

    if (!playlistId) {
        throw new ApiError(400, "playlistId is required");
    }

    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: { id: true, ownerId: true, isDeleted: true, name: true },
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    if (playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to delete this playlist");
    }

    if (isWatchLater(playlist)) {
        throw new ApiError(403, "Watch Later playlist cannot be deleted");
    }


    if (playlist.isDeleted) {
        return res
            .status(200)
            .json(new ApiResponse(200, {}, "Playlist already deleted"));
    }

    await prisma.playlist.update({
        where: { id: playlistId },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Playlist moved to trash")
    );
});

export const restorePlaylist = asyncHandler(async (req, res) => {
    const { playlistId } = req.params;

    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: {
            id: true,
            ownerId: true,
            isDeleted: true,
            deletedAt: true,
        },
    });

    if (!playlist || !playlist.isDeleted || !playlist.deletedAt) {
        throw new ApiError(404, "Deleted playlist not found");
    }

    if (playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to restore this playlist");
    }

    const restoreDeadline = playlist.deletedAt.getTime() + SEVEN_DAYS;
    if (Date.now() > restoreDeadline) {
        throw new ApiError(403, "Restore window expired");
    }

    await prisma.playlist.update({
        where: { id: playlistId },
        data: {
            isDeleted: false,
            deletedAt: null,
        },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Playlist restored successfully")
    );
});

export const getDeletedPlaylists = asyncHandler(async (req, res) => {
    const { page = "1", limit = "20" } = req.query;
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);

    const whereClause = {
        ownerId: req.user.id,
        isDeleted: true,
        deletedAt: {
            gte: new Date(Date.now() - SEVEN_DAYS),
        },
    };

    const playlists = await prisma.playlist.findMany({
        where: whereClause,
        orderBy: { deletedAt: "desc" },
        skip,
        take: safeLimit,
        select: {
            id: true,
            name: true,
            description: true,
            deletedAt: true,
        },
    });

    const totalPlaylists = await prisma.playlist.count({
        where: whereClause,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "playlists",
                items: playlists,
                currentPage: safePage,
                limit: safeLimit,
                totalItems: totalPlaylists,
                legacyTotalKey: "totalPlaylists",
            }),
            "Deleted playlists fetched"
        )
    );
});

export const updatePlaylist = asyncHandler(async (req, res) => {
    const { playlistId } = req.params;
    const { name, description } = req.body;
    const normalizedName = name === undefined ? undefined : normalizeText(name);
    const normalizedDescription =
        description === undefined ? undefined : normalizeText(description);

    if (!playlistId) {
        throw new ApiError(400, "playlistId is required");
    }

    // At least one field must be updated
    if (normalizedName === undefined && normalizedDescription === undefined) {
        throw new ApiError(400, "At least one field (name or description) is required");
    }

    if (normalizedName !== undefined) {
        if (!normalizedName) {
            throw new ApiError(400, "Playlist name cannot be empty");
        }
        if (normalizedName.length > MAX_PLAYLIST_NAME_LENGTH) {
            throw new ApiError(400, `Playlist name too long (max ${MAX_PLAYLIST_NAME_LENGTH})`);
        }
        if (normalizedName.toLowerCase() === WATCH_LATER_NAME.toLowerCase()) {
            throw new ApiError(400, "This playlist name is reserved");
        }
    }

    if (
        normalizedDescription !== undefined &&
        normalizedDescription.length > MAX_PLAYLIST_DESCRIPTION_LENGTH
    ) {
        throw new ApiError(
            400,
            `Playlist description too long (max ${MAX_PLAYLIST_DESCRIPTION_LENGTH})`
        );
    }

    // Fetch playlist + ownership check
    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: {
            id: true,
            ownerId: true,
            isDeleted: true,
            name: true,
        },
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    if (playlist.isDeleted) {
        throw new ApiError(404, "Playlist not found");
    }

    if (playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to update this playlist");
    }

    if (isWatchLater(playlist)) {
        throw new ApiError(403, "Watch Later playlist cannot be modified");
    }

    if (
        normalizedName !== undefined &&
        normalizedName.toLowerCase() !== String(playlist.name).toLowerCase()
    ) {
        const duplicate = await prisma.playlist.findFirst({
            where: {
                ownerId: req.user.id,
                isDeleted: false,
                id: { not: playlistId },
                name: {
                    equals: normalizedName,
                    mode: "insensitive",
                },
            },
            select: { id: true },
        });

        if (duplicate) {
            throw new ApiError(409, "Playlist with this name already exists");
        }
    }

    const updatedPlaylist = await prisma.playlist.update({
        where: { id: playlistId },
        data: {
            ...(normalizedName !== undefined && { name: normalizedName }),
            ...(normalizedDescription !== undefined && { description: normalizedDescription }),
        },
    });

    return res.status(200).json(
        new ApiResponse(200, updatedPlaylist, "Playlist updated successfully")
    );
});

export const togglePlaylistPublishStatus = asyncHandler(async (req, res) => {
    const { playlistId } = req.params;

    if (!playlistId) {
        throw new ApiError(400, "playlistId is required");
    }

    // Fetch playlist
    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: {
            id: true,
            ownerId: true,
            isPublic: true,
            isDeleted: true,
            name: true,
        },
    });


    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    if (isWatchLater(playlist)) {
        throw new ApiError(403, "Watch Later playlist must remain private");
    }

    if (playlist.isDeleted) {
        throw new ApiError(404, "Playlist not found");
    }


    // Ownership check
    if (playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to update this playlist");
    }

    // Toggle visibility
    const updatedPlaylist = await prisma.playlist.update({
        where: { id: playlistId },
        data: {
            isPublic: !playlist.isPublic,
        },
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                isPublic: updatedPlaylist.isPublic,
            },
            "Playlist visibility updated"
        )
    );
});

export const toggleWatchLater = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const userId = req.user.id;

    if (!videoId) throw new ApiError(400, "videoId is required");

    const playlistId = await getOrCreateWatchLater(userId);

    const result = await prisma.$transaction(async (tx) => {
        const video = await tx.video.findUnique({
            where: { id: videoId },
            select: {
                duration: true,
                ownerId: true,
                isDeleted: true,
                isPublished: true,
                processingStatus: true,
                isHlsReady: true,
            },
        });

        if (!video) throw new ApiError(404, "Video not found");

        if (video.isDeleted) throw new ApiError(404, "Video not found");

        const canAccessVideo =
            video.ownerId === userId ||
            (video.isPublished &&
                video.processingStatus === "COMPLETED" &&
                video.isHlsReady);

        if (!canAccessVideo) {
            throw new ApiError(403, "Video is not available");
        }

        const exists = await tx.playlistVideo.findUnique({
            where: { playlistId_videoId: { playlistId, videoId } },
        });

        if (exists) {
            await tx.playlistVideo.delete({
                where: { playlistId_videoId: { playlistId, videoId } },
            });

            await tx.playlist.update({
                where: { id: playlistId },
                data: {
                    videoCount: { decrement: 1 },
                    totalDuration: { decrement: video.duration },
                },
            });

            return { saved: false };
        }

        await tx.playlistVideo.create({
            data: { playlistId, videoId },
        });

        await tx.playlist.update({
            where: { id: playlistId },
            data: {
                videoCount: { increment: 1 },
                totalDuration: { increment: video.duration },
                lastVideoAddedAt: new Date(),
            },
        });

        return { saved: true };
    });

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                result,
                result.saved ? "Added to Watch Later" : "Removed from Watch Later"
            )
        );
});

export const getWatchLaterVideos = asyncHandler(async (req, res) => {

    const userId = req.user.id;

    let { page = "1", limit = "20" } = req.query;
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);

    const playlist = await prisma.playlist.findFirst({
        where: {
            ownerId: userId,
            name: WATCH_LATER_NAME,
            isDeleted: false,
        },
        select: {
            id: true,
            videoCount: true,
            totalDuration: true,
            lastVideoAddedAt: true,
        },
    });

    if (!playlist) {
        return res.status(200).json(
            new ApiResponse(
                200,
                buildPaginatedListData({
                    key: "videos",
                    items: [],
                    currentPage: safePage,
                    limit: safeLimit,
                    totalItems: 0,
                    legacyTotalKey: "totalVideos",
                    extra: {
                        metadata: {
                            videoCount: 0,
                            savedVideoCount: 0,
                            totalDuration: 0,
                            lastVideoAddedAt: null,
                        },
                    },
                }),
                "No watch later videos"
            )
        );
    }

    const visibleVideoWhere = {
        playlistId: playlist.id,
        video: {
            isDeleted: false,
            OR: [
                { ownerId: userId },
                {
                    isPublished: true,
                    processingStatus: "COMPLETED",
                    isHlsReady: true,
                },
            ],
        },
    };

    const [videos, visibleVideoCount] = await Promise.all([
        prisma.playlistVideo.findMany({
            where: visibleVideoWhere,
            orderBy: {
                createdAt: "desc",
            },
            skip,
            take: safeLimit,
            select: {
                video: {
                    select: {
                        id: true,
                        title: true,
                        thumbnail: true,
                        duration: true,
                        views: true,
                        createdAt: true,
                    },
                },
            },
        }),
        prisma.playlistVideo.count({ where: visibleVideoWhere }),
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "videos",
                items: videos.map(v => v.video),
                currentPage: safePage,
                limit: safeLimit,
                totalItems: visibleVideoCount,
                legacyTotalKey: "totalVideos",
                extra: {
                    metadata: {
                        videoCount: visibleVideoCount,
                        savedVideoCount: playlist.videoCount,
                        totalDuration: playlist.totalDuration,
                        lastVideoAddedAt: playlist.lastVideoAddedAt,
                    },
                },
            }),
            "Watch later videos fetched"
        )
    );

});
