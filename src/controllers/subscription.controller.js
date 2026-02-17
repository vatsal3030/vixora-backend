import asyncHandler from "../utils/asyncHandler.js"
import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const updateChannelVideoScores = async (channelId) => {

    const videos = await prisma.video.findMany({
        where: { 
            ownerId: channelId,
            isPublished: true,
            isDeleted: false,
            processingStatus: "COMPLETED",
            isHlsReady: true
        },
        select: { id: true, views: true }
    });

    for (const video of videos) {

        const [likesCount, commentsCount, watchCount] = await Promise.all([
            prisma.like.count({ where: { videoId: video.id } }),
            prisma.comment.count({ where: { videoId: video.id } }),
            prisma.watchHistory.count({ where: { videoId: video.id } })
        ]);

        const score =
            video.views * 0.3 +
            likesCount * 0.4 +
            commentsCount * 0.2 +
            watchCount * 0.1 +
            5;

        await prisma.video.update({
            where: { id: video.id },
            data: {
                popularityScore: score,
                engagementScore: score / 10
            }
        });
    }
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
                    fullName: true,
                    avatar: true,
                    _count: {
                        select: {
                            subscribers: true
                        }
                    }
                },
            },
            createdAt: true,
        },
        orderBy: { createdAt: "desc" },
    });

    const channelList = subscriptions.map(sub => ({
        ...sub.channel,
        subscribersCount: sub.channel._count.subscribers,
        subscribedAt: sub.createdAt,
        _count: undefined
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
            isPublished: true,
            isDeleted: false,
            processingStatus: "COMPLETED",
            isHlsReady: true,
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
            isPublished: true,
            isDeleted: false,
            processingStatus: "COMPLETED",
            isHlsReady: true,
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

export const setNotificationLevel = asyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const { level } = req.body;
    const userId = req.user.id;

    if (!channelId) {
        throw new ApiError(400, "Channel ID is required");
    }

    if (!level) {
        throw new ApiError(400, "Notification level is required");
    }

    // Find the subscription of logged-in user to that channel
    const subscription = await prisma.subscription.findUnique({
        where: {
            subscriberId_channelId: {
                subscriberId: userId,
                channelId
            }
        },
        select: { id: true }
    });

    if (!subscription) {
        throw new ApiError(404, "Subscription not found");
    }

    // Update preference
    const updated = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
            notificationLevel: level
        },
        select: {
            id: true,
            subscriberId: true,
            channelId: true,
            notificationLevel: true
        }
    });

    return res.status(200).json(
        new ApiResponse(200, updated, "Notification level updated successfully")
    );
});

export const getSubscriptionStatus = asyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const userId = req.user.id;

    if (!channelId) {
        throw new ApiError(400, "Channel ID is required");
    }

    const subscription = await prisma.subscription.findFirst({
        where: {
            subscriberId: userId,
            channelId
        },
        select: {
            id: true,
            notificationLevel: true
        }
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                isSubscribed: !!subscription,
                subscriptionId: subscription?.id || null,
                notificationLevel: subscription?.notificationLevel || "NONE"
            },
            "Subscription status fetched successfully"
        )
    );
});
