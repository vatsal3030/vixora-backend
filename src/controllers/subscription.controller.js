import asyncHandler from "../utils/asyncHandler.js"
import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const updateChannelVideoScores = async (channelId) => {
    const videos = await prisma.video.findMany({
        where: { ownerId: channelId },
        select: {
            id: true,
            views: true,
            likes: true,
            comments: true,
            watchHistory: true
        }
    });

    const updates = videos.map(video => {
        const score =
            video.views * 0.3 +
            video.likes.length * 0.4 +
            video.comments.length * 0.2 +
            video.watchHistory.length * 0.1 +
            5; // subscription bonus

        return prisma.video.update({
            where: { id: video.id },
            data: {
                popularityScore: score,
                engagementScore: score / 10
            }
        });
    });

    await Promise.all(updates);
};


export const toggleSubscription = asyncHandler(async (req, res) => {
    const { channelId } = req.params;

    if (!channelId) {
        throw new ApiError(400, "Channel ID is required");
    }

    const userId = req.user?.id;
    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    if (channelId === userId) {
        throw new ApiError(400, "You cannot subscribe to your own channel");
    }

    const channel = await prisma.user.findUnique({
        where: { id: channelId },
        select: { id: true },
    });

    if (!channel) {
        throw new ApiError(404, "Channel not found");
    }

    const existingSubscription = await prisma.subscription.findUnique({
        where: {
            subscriberId_channelId: {
                subscriberId: userId,
                channelId,
            },
        },
    });

    if (existingSubscription) {
        await prisma.subscription.delete({
            where: { id: existingSubscription.id },
        });

        const subscriberCount = await prisma.subscription.count({
            where: { channelId },
        });

        return res.status(200).json(
            new ApiResponse(
                200,
                { status: "unsubscribed", subscriberCount },
                "Unsubscribed successfully"
            )
        );
    }

    await prisma.subscription.create({
        data: {
            subscriberId: userId,
            channelId,
        },
    });

    // 🔥 IMPORTANT: update all video scores of that channel
    await updateChannelVideoScores(channelId);

    const subscriberCount = await prisma.subscription.count({
        where: { channelId },
    });

    return res.status(201).json(
        new ApiResponse(
            201,
            { status: "subscribed", subscriberCount },
            "Subscribed successfully"
        )
    );
});


export const getSubscriberCount = asyncHandler(async (req, res) => {
    const { channelId } = req.params;

    if (!channelId) {
        throw new ApiError(400, "Channel ID is required");
    }

    const channel = await prisma.user.findUnique({
        where: { id: channelId },
        select: { id: true },
    });

    if (!channel) {
        throw new ApiError(404, "Channel not found");
    }

    const subscriberCount = await prisma.subscription.count({
        where: { channelId },
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            { subscriberCount },
            "Subscriber count fetched successfully"
        )
    );
});

// controller to return channel list to which user has subscribed
export const getSubscribedChannels = asyncHandler(async (req, res) => {
    const subscriberId = req.user?.id;

    if (!subscriberId) {
        throw new ApiError(401, "Unauthorized");
    }

    const subscriptions = await prisma.subscription.findMany({
        where: { subscriberId },
        select: {
            channel: {
                select: {
                    id: true,
                    username: true,
                    avatar: true,
                },
            },
            createdAt: true,
        },
        orderBy: { createdAt: "desc" },
    });

    const channelList = subscriptions.map(sub => ({
        ...sub.channel,
        subscribedAt: sub.createdAt,
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            channelList,
            "Subscribed channels fetched successfully"
        )
    );
});

export const getSubscribedVideos = asyncHandler(async (req, res) => {
    const userId = req.user?.id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    let { page = "1", limit = "10" } = req.query;

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    // 1️⃣ Get all subscribed channels
    const subscriptions = await prisma.subscription.findMany({
        where: { subscriberId: userId },
        select: { channelId: true }
    });

    const channelIds = subscriptions.map(sub => sub.channelId);

    if (channelIds.length === 0) {
        return res.status(200).json(
            new ApiResponse(200, {
                videos: [],
                pagination: {
                    currentPage: page,
                    totalPages: 0,
                    totalVideos: 0
                }
            }, "No subscribed channels")
        );
    }

    // 2️⃣ Fetch videos from subscribed channels
    const videos = await prisma.video.findMany({
        where: {
            ownerId: { in: channelIds },
            isPublished: true
        },
        orderBy: {
            createdAt: "desc"
        },
        skip,
        take: limit,
        select: {
            id: true,
            title: true,
            thumbnail: true,
            views: true,
            duration: true,
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

    const totalVideos = await prisma.video.count({
        where: {
            ownerId: { in: channelIds },
            isPublished: true
        }
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                videos,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalVideos / limit),
                    totalVideos
                }
            },
            "Subscribed videos fetched successfully"
        )
    );
});


