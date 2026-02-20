import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import { deleteImageOnCloudinary } from "../utils/cloudinary.js";
import { verifyCloudinaryAssetOwnership } from "../utils/verifyCloudinaryAsset.js";
import { sanitizePagination } from "../utils/pagination.js";
import { sanitizeSort } from "../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../utils/listResponse.js";
import {
    ChannelNotificationAudience,
    dispatchChannelActivityNotification,
} from "../services/notification.service.js";

const MAX_TWEET_CONTENT_LENGTH = 500;

export const createTweet = asyncHandler(async (req, res) => {

    const content = String(req.body?.content ?? "").trim();
    const imagePublicId = String(req.body?.imagePublicId ?? "").trim();

    if (!content) {
        throw new ApiError(400, "Content required");
    }

    if (content.length > MAX_TWEET_CONTENT_LENGTH) {
        throw new ApiError(400, `Tweet content too long (max ${MAX_TWEET_CONTENT_LENGTH})`);
    }

    if (!req.user.emailVerified) {
        throw new ApiError(403, "Verify email first");
    }

    let finalImageUrl = null;
    let finalImagePublicId = null;

    if (imagePublicId) {

        const resource = await verifyCloudinaryAssetOwnership(
            imagePublicId,
            `tweets/${req.user.id}`
        );

        finalImageUrl = resource.secure_url;
        finalImagePublicId = resource.public_id;
    }


    const tweet = await prisma.tweet.create({
        data: {
            content,
            image: finalImageUrl,
            imageId: finalImagePublicId,
            ownerId: req.user.id
        }
    });

    const channelName =
        req.user?.fullName ||
        req.user?.username ||
        "A channel you follow";

    void dispatchChannelActivityNotification({
        channelId: req.user.id,
        senderId: req.user.id,
        activityType: "POST_CREATED",
        audience: ChannelNotificationAudience.ALL_ONLY,
        title: "New post",
        message: `${channelName} posted: "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}"`,
        extraData: {
            channelName,
            tweetId: tweet.id,
        },
    }).catch((error) => {
        console.error(
            "Notification dispatch failed (tweet):",
            error?.message || error
        );
    });

    return res.status(201).json(
        new ApiResponse(201, tweet, "Tweet created")
    );
});


export const getUserTweets = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    let { page = "1", limit = "10", sortBy = "createdAt", sortType = "desc" } = req.query;

    if (!userId) {
        throw new ApiError(400, "User ID is required");
    }

    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);

    const safeSort = sanitizeSort(sortBy, sortType, ["createdAt", "updatedAt"], "createdAt");
    sortBy = safeSort.sortBy;
    sortType = safeSort.sortType;


    const tweets = await prisma.tweet.findMany({
        where: {
            ownerId: userId,
            isDeleted: false,
        },
        orderBy: { [sortBy]: sortType },
        skip,
        take: safeLimit,
        select: {
            id: true,
            content: true,
            image: true,
            createdAt: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    fullName: true,
                    avatar: true,
                },
            },
            _count: {
                select: {
                    likes: true,
                    comments: true,
                },
            },
        },
    });

    // Format tweets with like counts
    const formattedTweets = tweets.map(tweet => ({
        ...tweet,
        likesCount: tweet._count.likes,
        commentsCount: tweet._count.comments,
        _count: undefined
    }));

    const totalTweets = await prisma.tweet.count({
        where: {
            ownerId: userId,
            isDeleted: false,
        },
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "tweets",
                items: formattedTweets,
                currentPage: safePage,
                limit: safeLimit,
                totalItems: totalTweets,
                legacyTotalKey: "totalTweets",
            }),
            "Tweets fetched successfully"
        )
    );
});

export const getTweetById = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    if (!tweetId) {
        throw new ApiError(400, "Tweet ID is required");
    }

    const tweet = await prisma.tweet.findFirst({
        where: {
            id: tweetId,
            isDeleted: false,
        },
        select: {
            id: true,
            content: true,
            image: true,
            createdAt: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true,
                },
            },
            _count: {
                select: {
                    likes: true,
                    comments: true,
                },
            },
        },
    });

    if (!tweet) {
        throw new ApiError(404, "Tweet not found");
    }

    return res.status(200).json(
        new ApiResponse(200, tweet, "Tweet fetched successfully")
    );
});

export const updateTweet = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;
    const content = String(req.body?.content ?? "").trim();

    if (!content) {
        throw new ApiError(400, "Content is required");
    }

    if (content.length > MAX_TWEET_CONTENT_LENGTH) {
        throw new ApiError(400, `Tweet content too long (max ${MAX_TWEET_CONTENT_LENGTH})`);
    }

    const tweet = await prisma.tweet.findFirst({
        where: {
            id: tweetId,
            isDeleted: false,
        },
        select: {
            ownerId: true,
        },
    });

    if (!tweet) {
        throw new ApiError(404, "Tweet not found");
    }

    if (tweet.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to update this tweet");
    }

    const updatedTweet = await prisma.tweet.update({
        where: { id: tweetId },
        data: {
            content,
        },
    });

    return res.status(200).json(
        new ApiResponse(200, updatedTweet, "Tweet updated successfully")
    );
});

export const deleteTweet = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    const tweet = await prisma.tweet.findFirst({
        where: {
            id: tweetId,
            isDeleted: false,
        },
        select: {
            ownerId: true,
            imageId: true,
        },
    });

    if (!tweet) {
        throw new ApiError(404, "Tweet not found");
    }

    if (tweet.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to delete this tweet");
    }

    // Optional cleanup
    if (tweet.imageId) {
        await deleteImageOnCloudinary(tweet.imageId);
    }

    await prisma.tweet.update({
        where: { id: tweetId },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Tweet deleted successfully")
    );
});

export const restoreTweet = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    const tweet = await prisma.tweet.findFirst({
        where: {
            id: tweetId,
            isDeleted: true,
        },
        select: {
            ownerId: true,
        },
    });

    if (!tweet) {
        throw new ApiError(404, "Tweet not found or not deleted");
    }

    if (tweet.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to restore this tweet");
    }

    await prisma.tweet.update({
        where: { id: tweetId },
        data: {
            isDeleted: false,
            deletedAt: null,
        },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Tweet restored successfully")
    );
});

export const getDeletedTweets = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    let { page = "1", limit = "20" } = req.query;

    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);

    const deletedTweets = await prisma.tweet.findMany({
        where: {
            ownerId: userId,
            isDeleted: true,
        },
        orderBy: {
            updatedAt: "desc",
        },
        skip,
        take: safeLimit,
        select: {
            id: true,
            content: true,
            image: true,
            updatedAt: true,
        },
    });

    const totalDeletedTweets = await prisma.tweet.count({
        where: {
            ownerId: userId,
            isDeleted: true,
        },
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "tweets",
                items: deletedTweets,
                currentPage: safePage,
                limit: safeLimit,
                totalItems: totalDeletedTweets,
                legacyTotalKey: "totalTweets",
            }),
            "Deleted tweets fetched"
        )
    );
});


