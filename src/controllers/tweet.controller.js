import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import { deleteImageOnCloudinary } from "../utils/cloudinary.js";
import { verifyCloudinaryAssetOwnership } from "../utils/verifyCloudinaryAsset.js";

export const createTweet = asyncHandler(async (req, res) => {

    const { content, imageUrl, imagePublicId } = req.body;

    if (!content?.trim()) {
        throw new ApiError(400, "Content required");
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
            content: content.trim(),
            image: finalImageUrl,
            imageId: finalImagePublicId,
            ownerId: req.user.id
        }
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

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    const allowedSortFields = [
        "createdAt",
        "updatedAt"
    ];

    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "createdAt";
    }

    sortType = sortType === "asc" ? "asc" : "desc";


    const tweets = await prisma.tweet.findMany({
        where: {
            ownerId: userId,
            isDeleted: false,
        },
        orderBy: { [sortBy]: sortType },
        skip,
        take: limit,
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

    const totalTweets = await prisma.tweet.count({
        where: {
            ownerId: userId,
            isDeleted: false,
        },
    });

    // Format tweets with like counts
    const formattedTweets = tweets.map(tweet => ({
        ...tweet,
        likesCount: tweet._count.likes,
        commentsCount: tweet._count.comments,
        _count: undefined
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            formattedTweets,
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
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
        throw new ApiError(400, "Content is required");
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
            content: content.trim(),
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
        data: { isDeleted: true },
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
        data: { isDeleted: false },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Tweet restored successfully")
    );
});

export const getDeletedTweets = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const deletedTweets = await prisma.tweet.findMany({
        where: {
            ownerId: userId,
            isDeleted: true,
        },
        orderBy: {
            updatedAt: "desc",
        },
        select: {
            id: true,
            content: true,
            image: true,
            updatedAt: true,
        },
    });



    return res.status(200).json(
        new ApiResponse(200, deletedTweets, "Deleted tweets fetched")
    );
});


