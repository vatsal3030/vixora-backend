import asyncHandler from "../utils/asyncHandler.js"
import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

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


// // controller to return subscriber list of a channel
// export const getUserChannelSubscribers = asyncHandler(async (req, res) => {
//     const { channelId } = req.params;

//     if (!channelId) {
//         throw new ApiError(400, "Channel ID is required");
//     }

//     // ✅ Check channel existence
//     const channel = await prisma.user.findUnique({
//         where: { id: channelId },
//         select: { id: true },
//     });

//     if (!channel) {
//         throw new ApiError(404, "Channel not found");
//     }

//     const subscribers = await prisma.subscription.findMany({
//         where: {
//             channelId: channelId,
//         },
//         select: {
//             subscriber: {
//                 select: {
//                     id: true,
//                     username: true,
//                     avatar: true,
//                 },
//             },
//             createdAt: true, // when subscribed
//         },
//         orderBy: {
//             createdAt: "desc",
//         },
//     });

//     // flatten response
//     const subscriberList = subscribers.map(sub => ({
//         ...sub.subscriber,
//         subscribedAt: sub.createdAt,
//     }));

//     return res.status(200).json(
//         new ApiResponse(
//             200,
//             subscriberList,
//             "Channel subscribers fetched successfully"
//         )
//     );
// });


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
