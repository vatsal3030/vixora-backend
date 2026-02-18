import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import { getCachedValue, setCachedValue } from "../utils/cache.js";

const CHANNEL_INFO_CACHE_TTL_SECONDS = 30;

export const getChannelInfo = asyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const userId = req.user?.id;

    const cacheParams = {
        channelId,
        viewerId: userId || "anonymous",
    };

    const cached = await getCachedValue({
        scope: "channel:info",
        params: cacheParams,
    });

    if (cached.hit && cached.value) {
        return res.status(200).json(
            new ApiResponse(200, cached.value.data, cached.value.message)
        );
    }

    const channel = await prisma.user.findUnique({
        where: { id: channelId },
        select: {
            id: true,
            username: true,
            avatar: true,
            coverImage: true,
            channelDescription: true,
            channelLinks: true,
            createdAt: true,
            _count: {
                select: {
                    subscribers: true,
                    videos: true
                }
            }
        }
    });

    if (!channel) {
        throw new ApiError(404, "Channel not found");
    }

    let isSubscribed = false;

    if (userId) {
        const subscription = await prisma.subscription.findUnique({
            where: {
                subscriberId_channelId: {
                    subscriberId: userId,
                    channelId
                }
            }
        });
        isSubscribed = !!subscription;
    }

    const responseData = {
        id: channel.id,
        username: channel.username,
        avatar: channel.avatar,
        coverImage: channel.coverImage,
        description: channel.channelDescription,
        category: null,
        links: channel.channelLinks,
        subscribersCount: channel._count.subscribers,
        videosCount: channel._count.videos,
        joinedAt: channel.createdAt,
        isSubscribed
    };

    const responseMessage = "Channel info fetched";

    await setCachedValue({
        scope: "channel:info",
        params: cacheParams,
        value: { data: responseData, message: responseMessage },
        ttlSeconds: CHANNEL_INFO_CACHE_TTL_SECONDS,
    });

    return res.status(200).json(
        new ApiResponse(200, responseData, responseMessage)
    );
});

export const getChannelVideos = asyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const { sort = "latest", page = 1, limit = 12 } = req.query;

    const skip = (page - 1) * limit;

    let orderBy = { createdAt: "desc" };
    if (sort === "popular") orderBy = { views: "desc" };
    if (sort === "oldest") orderBy = { createdAt: "asc" };

    const videos = await prisma.video.findMany({
        where: {
            ownerId: channelId,
            isPublished: true,
            isDeleted: false,
            processingStatus: "COMPLETED",
            isHlsReady: true,
            isShort: false
        },
        orderBy,
        skip,
        take: Number(limit),
        select: {
            id: true,
            title: true,
            thumbnail: true,
            views: true,
            createdAt: true,
            duration: true
        }
    });

    const total = await prisma.video.count({
        where: {
            ownerId: channelId,
            isPublished: true,
            isDeleted: false,
            processingStatus: "COMPLETED",
            isHlsReady: true,
            isShort: false
        }
    });

    return res.status(200).json(
        new ApiResponse(200, {
            videos,
            pagination: {
                page: Number(page),
                totalPages: Math.ceil(total / limit),
                total
            }
        }, "Channel videos fetched")
    );
});

export const getChannelPlaylists = asyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const { page = 1, limit = 12 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const playlists = await prisma.playlist.findMany({
        where: {
            ownerId: channelId,
            isPublic: true,
            isDeleted: false
        },
        skip,
        take: Number(limit),
        orderBy: {
            updatedAt: "desc"
        },
        select: {
            id: true,
            name: true,
            description: true,
            isPublic: true,
            videoCount: true,
            totalDuration: true,
            updatedAt: true,
            createdAt: true
        }
    });

    const total = await prisma.playlist.count({
        where: {
            ownerId: channelId,
            isPublic: true,
            isDeleted: false
        }
    });

    const formattedPlaylists = playlists.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        isPublic: p.isPublic,
        videoCount: p.videoCount,
        totalDuration: p.totalDuration,
        updatedAt: p.updatedAt,
        isWatchLater: p.name === "Watch Later"
    }));

    return res.status(200).json(
        new ApiResponse(200, {
            playlists: formattedPlaylists,
            pagination: {
                page: Number(page),
                totalPages: Math.ceil(total / limit),
                total
            }
        }, "Channel playlists fetched successfully")
    );
});

export const getChannelTweets = asyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const tweets = await prisma.tweet.findMany({
        where: {
            ownerId: channelId,
            isDeleted: false
        },
        orderBy: {
            createdAt: "desc"
        },
        skip,
        take: Number(limit),
        select: {
            id: true,
            content: true,
            image: true,
            createdAt: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true
                }
            }
        }
    });

    const total = await prisma.tweet.count({
        where: {
            ownerId: channelId,
            isDeleted: false
        }
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                tweets,
                pagination: {
                    page: Number(page),
                    totalPages: Math.ceil(total / limit),
                    total
                }
            },
            "Channel tweets fetched successfully"
        )
    );
});




