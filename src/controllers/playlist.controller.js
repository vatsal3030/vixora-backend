import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import { getOrCreateWatchLater } from "../utils/getOrCreateWatchLaterPlaylist.js";

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

const WATCH_LATER_NAME = "Watch Later";

const isWatchLater = (playlist) => playlist.name === WATCH_LATER_NAME;


export const createPlaylist = asyncHandler(async (req, res) => {
    const { name, description, isPublic = false } = req.body
    //TODO: create playlist
    if (!name || name.trim().length === 0) {
        throw new ApiError(400, "Playlist name is required");
    }

    const existing = await prisma.playlist.findFirst({
        where: {
            ownerId: req.user.id,
            name: name.trim(),
            isDeleted: false,
        },
    });

    if (existing) {
        throw new ApiError(409, "Playlist with this name already exists");
    }


    const playlist = await prisma.playlist.create({
        data: {
            name: name.trim(),
            description: description?.trim() || "",
            isPublic,
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
            {
                playlists: formattedPlaylists,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalPlaylists / limit),
                    totalPlaylists,
                },
            },
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

    const pageNum = Number(page);
    const limitNum = Math.min(Number(limit), 100); // hard cap
    const skip = (pageNum - 1) * limitNum;

    // 1️⃣ Fetch playlist meta ONLY (cheap query)
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

    if (!playlist || playlist.isDeleted) {
        throw new ApiError(404, "Playlist not found");
    }

    // 🔐 Private playlist access
    if (!playlist.isPublic && playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "This playlist is private");
    }

    // 2️⃣ Fetch paginated videos (separate optimized query)
    const playlistVideos = await prisma.playlistVideo.findMany({
        where: { playlistId },
        orderBy: { createdAt: "desc" }, // ✅ STACK ORDER (last added first)
        skip,
        take: limitNum,
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

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                id: playlist.id,
                name: playlist.name,
                description: playlist.description,
                isPublic: playlist.isPublic,
                isWatchLater: playlist.name === WATCH_LATER_NAME,
                createdAt: playlist.createdAt,
                updatedAt: playlist.updatedAt,
                videoCount: playlist.videoCount,
                totalDuration: playlist.totalDuration,
                owner: playlist.owner,
                videos: playlistVideos.map(v => v.video),
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    hasMore: skip + playlistVideos.length < playlist.videoCount,
                },
            },
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
        select: { id: true },
    });

    if (!videoExists) {
        throw new ApiError(404, "Video not found");
    }

    if (playlist.videos.length > 0) {
        return res
            .status(200)
            .json(new ApiResponse(200, {}, "Video already in playlist"));
    }

    // ✅ CORRECT WAY
    await prisma.$transaction(async (tx) => {
        const video = await tx.video.findUnique({
            where: { id: videoId },
            select: { duration: true },
        });

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
    const playlists = await prisma.playlist.findMany({
        where: {
            ownerId: req.user.id,
            isDeleted: true,
            deletedAt: {
                gte: new Date(Date.now() - SEVEN_DAYS),
            },
        },
        orderBy: { deletedAt: "desc" },
        select: {
            id: true,
            name: true,
            description: true,
            deletedAt: true,
        },
    });

    return res.status(200).json(
        new ApiResponse(200, playlists, "Deleted playlists fetched")
    );
});

export const updatePlaylist = asyncHandler(async (req, res) => {
    const { playlistId } = req.params;
    const { name, description } = req.body;

    if (!playlistId) {
        throw new ApiError(400, "playlistId is required");
    }

    // At least one field must be updated
    if (!name && !description) {
        throw new ApiError(400, "At least one field (name or description) is required");
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

    const updatedPlaylist = await prisma.playlist.update({
        where: { id: playlistId },
        data: {
            ...(name && { name: name.trim() }),
            ...(description !== undefined && { description: description.trim() }),
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
            select: { duration: true },
        });

        if (!video) throw new ApiError(404, "Video not found");

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

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 20;

    const skip = (page - 1) * limit;

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
            lastVideoAddedAt: true
        }
    });

    if (!playlist) {
        return res.status(200).json(
            new ApiResponse(200, {
                videos: [],
                pagination: {
                    currentPage: page,
                    totalPages: 0,
                    totalVideos: 0
                },
                metadata: {
                    videoCount: 0,
                    totalDuration: 0,
                    lastVideoAddedAt: null
                }
            }, "No watch later videos")
        );
    }

    // ✅ PAGINATED FETCH FROM JOIN TABLE
    const videos = await prisma.playlistVideo.findMany({
        where: {
            playlistId: playlist.id
        },
        orderBy: {
            createdAt: "desc"
        },
        skip,
        take: limit,
        select: {
            video: {
                select: {
                    id: true,
                    title: true,
                    thumbnail: true,
                    duration: true,
                    views: true,
                    createdAt: true
                }
            }
        }
    });

    return res.status(200).json(
        new ApiResponse(200, {
            videos: videos.map(v => v.video),
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(playlist.videoCount / limit),
                totalVideos: playlist.videoCount
            },
            metadata: {
                videoCount: playlist.videoCount,
                totalDuration: playlist.totalDuration,
                lastVideoAddedAt: playlist.lastVideoAddedAt
            }
        }, "Watch later videos fetched")
    );

});



