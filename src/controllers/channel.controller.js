import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"

export const getChannelInfo = asyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const userId = req.user?.id;

    const channel = await prisma.user.findUnique({
        where: { id: channelId },
        select: {
            id: true,
            username: true,
            avatar: true,
            coverImage: true,
            channelDescription: true,
            channelLinks: true,
            channelCategory: true,
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

    return res.status(200).json(
        new ApiResponse(200, {
            id: channel.id,
            username: channel.username,
            avatar: channel.avatar,
            coverImage: channel.coverImage,
            description: channel.channelDescription,
            category: channel.channelCategory,
            links: channel.channelLinks,
            subscribersCount: channel._count.subscribers,
            videosCount: channel._count.videos,
            joinedAt: channel.createdAt,
            isSubscribed
        }, "Channel info fetched")
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
            isPublic: true
        },
        skip,
        take: Number(limit),
        orderBy: {
            createdAt: "desc"
        },
        select: {
            id: true,
            name: true,
            description: true,
            createdAt: true,
            _count: {
                select: {
                    videos: true
                }
            }
        }
    });

    const total = await prisma.playlist.count({
        where: {
            ownerId: channelId,
            isPublic: true
        }
    });

    return res.status(200).json(
        new ApiResponse(200, {
            playlists,
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




