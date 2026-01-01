import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"

export const createPlaylist = asyncHandler(async (req, res) => {
    const { name, description, isPublic = false } = req.body
    //TODO: create playlist
    if (!name || name.trim().length === 0) {
        throw new ApiError(400, "Playlist name is required");
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
        sortBy = "createdAt",
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

    // build filter
    const whereClause = {
        ownerId: userId,
    };

    if (query && query.trim().length > 0) {
        whereClause.name = {
            contains: query,
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
            description: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    const totalPlaylists = await prisma.playlist.count({
        where: whereClause,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                playlists,
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

    if (!playlistId) {
        throw new ApiError(400, "playlistId is required");
    }

    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: {
            id: true,
            name: true,
            description: true,
            isPublic: true,
            createdAt: true,
            updatedAt: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true,
                },
            },
            videos: {
                select: {
                    id: true,
                    title: true,
                    thumbnail: true,
                    duration: true,
                },
            },
        },
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    // If playlist is private, only owner can access
    if (!playlist.isPublic && playlist.owner.id !== req.user.id) {
        throw new ApiError(403, "This playlist is private");
    }

    return res.status(200).json(
        new ApiResponse(200, playlist, "Playlist fetched successfully")
    );
});


export const addVideoToPlaylist = asyncHandler(async (req, res) => {
    const { videoId, playlistId } = req.params;

    if (!playlistId || !videoId) {
        throw new ApiError(400, "playlistId and videoId are required");
    }

    // Fetch playlist with existing videos (only ids)
    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: {
            id: true,
            ownerId: true,
            videos: {
                where: { id: videoId },
                select: { id: true },
            },
        },
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    if (playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to modify this playlist");
    }

    // Check if video exists
    const videoExists = await prisma.video.findUnique({
        where: { id: videoId },
        select: { id: true },
    });

    if (!videoExists) {
        throw new ApiError(404, "Video not found");
    }

    // Prevent duplicate add
    if (playlist.videos.length > 0) {
        return res.status(200).json(
            new ApiResponse(200, {}, "Video already in playlist")
        );
    }

    await prisma.playlist.update({
        where: { id: playlistId },
        data: {
            videos: {
                connect: { id: videoId },
            },
        },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Video added to playlist")
    );
});


export const removeVideoFromPlaylist = asyncHandler(async (req, res) => {
    const { videoId, playlistId } = req.params;

    if (!playlistId || !videoId) {
        throw new ApiError(400, "playlistId and videoId are required");
    }

    // Fetch playlist + check ownership + check if video exists in playlist
    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: {
            id: true,
            ownerId: true,
            videos: {
                where: { id: videoId },
                select: { id: true },
            },
        },
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    if (playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to modify this playlist");
    }

    // If video is not in playlist
    if (playlist.videos.length === 0) {
        return res.status(200).json(
            new ApiResponse(200, {}, "Video is not in this playlist")
        );
    }

    // ✅ Remove video from playlist
    await prisma.playlist.update({
        where: { id: playlistId },
        data: {
            videos: {
                disconnect: { id: videoId },
            },
        },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Video removed from playlist")
    );
});


export const deletePlaylist = asyncHandler(async (req, res) => {
    const { playlistId } = req.params
    // TODO: delete playlist
    if (!playlistId) {
        throw new ApiError(400, "playlistId is required");
    }

    // Fetch playlist + check ownership 
    const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        select: {
            id: true,
            ownerId: true,
        },
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    if (playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to delete this playlist");
    }

    await prisma.playlist.delete({
        where: {
            id: playlistId
        }
    })

    return res.status(200).json(
        new ApiResponse(200, {}, "Playlist deleted successfully")
    );

})

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
        },
    });

    if (!playlist) {
        throw new ApiError(404, "Playlist not found");
    }

    if (playlist.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to update this playlist");
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
        },
    });

    if (!playlist) {
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
