import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import { deleteImageOnCloudinary } from "../utils/cloudinary.js";
import { verifyCloudinaryAssetOwnership } from "../utils/verifyCloudinaryAsset.js";
import { sanitizePagination } from "../utils/pagination.js";
import { sanitizeSort } from "../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../utils/listResponse.js";
import { getCachedValue, setCachedValue } from "../utils/cache.js";
import {
    ChannelNotificationAudience,
    dispatchChannelActivityNotification,
} from "../services/notification.service.js";

const MAX_TWEET_CONTENT_LENGTH = 500;
const MAX_FEED_LIMIT = 100;
const DEFAULT_FEED_LIMIT = 30;
const FEED_CACHE_TTL_SECONDS = 20;
const HOT_TOPICS_CACHE_TTL_SECONDS = 45;
const FEED_BACKFILL_POOL_MULTIPLIER = 6;
const FEED_BACKFILL_MIN_POOL_SIZE = 24;
const DEFAULT_HOT_TOPICS_LIMIT = 12;
const MAX_HOT_TOPICS_LIMIT = 30;
const DEFAULT_TOPICS_WINDOW_HOURS = 72;
const MAX_TOPICS_WINDOW_HOURS = 24 * 14;
const DEFAULT_FOR_YOU_CANDIDATE_SIZE = 220;

const DEFAULT_STOP_WORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "your",
    "you",
    "are",
    "was",
    "were",
    "have",
    "has",
    "had",
    "about",
    "into",
    "than",
    "then",
    "them",
    "they",
    "our",
    "out",
    "all",
    "but",
    "not",
    "just",
    "new",
    "now",
    "today",
    "tomorrow",
    "video",
    "post",
    "tweet",
    "http",
    "https",
    "www",
]);

const normalizeText = (value) => String(value ?? "").trim();
const normalizeTopicText = (value) => normalizeText(value).toLowerCase().replace(/^#/, "");
const parsePositiveInt = (value, fallback, max) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    if (Number.isInteger(max)) return Math.min(parsed, max);
    return parsed;
};

const toStableSeed = (input) => {
    const raw = String(input || "");
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i += 1) {
        hash ^= raw.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const seededShuffle = (items, seedInput) => {
    const arr = Array.isArray(items) ? [...items] : [];
    if (arr.length <= 1) return arr;

    let seed = toStableSeed(seedInput) || 1;
    const rand = () => {
        seed = Math.imul(seed, 1664525) + 1013904223;
        seed >>>= 0;
        return seed / 4294967296;
    };

    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr;
};

const resolveBackfillPoolTake = (needed) =>
    Math.max((Number(needed) || 0) * FEED_BACKFILL_POOL_MULTIPLIER, FEED_BACKFILL_MIN_POOL_SIZE);

const resolveBackfillSkip = ({ skip = 0, primaryTotal = 0, fallbackTotal = 0 }) => {
    const adjusted = Math.max(0, Number(skip || 0) - Math.max(0, Number(primaryTotal || 0)));
    const total = Math.max(0, Number(fallbackTotal || 0));
    if (total <= 0) return 0;
    return adjusted >= total ? adjusted % total : adjusted;
};

const resolveTweetFeedMode = (value, userId) => {
    const normalized = normalizeText(value).toLowerCase();
    if (["forYou", "foryou", "for_you", "for-you"].includes(normalized)) return userId ? "forYou" : "hot";
    if (["following", "followings"].includes(normalized)) return "following";
    if (["latest", "new", "recent"].includes(normalized)) return "latest";
    if (["hot", "trending"].includes(normalized)) return "hot";
    return userId ? "forYou" : "hot";
};

const buildPublicOwnerWhere = () => ({
    isDeleted: false,
    moderationStatus: "ACTIVE",
    AND: [
        {
            OR: [
                { settings: { is: null } },
                { settings: { is: { profileVisibility: "PUBLIC" } } },
            ],
        },
    ],
});

const extractTopicsFromTweetContent = (content) => {
    const text = normalizeText(content);
    if (!text) return [];

    const topics = [];
    const seen = new Set();
    const pushTopic = (value) => {
        const normalized = normalizeTopicText(value);
        if (!normalized || normalized.length < 2 || seen.has(normalized)) return;
        seen.add(normalized);
        topics.push(normalized);
    };

    const hashtagMatches = text.matchAll(/(^|\s)#([a-zA-Z0-9_]{2,40})/g);
    for (const match of hashtagMatches) {
        pushTopic(match?.[2] || "");
        if (topics.length >= 10) return topics;
    }

    const keywordMatches = text.toLowerCase().match(/[a-z0-9_]{3,30}/g) || [];
    for (const token of keywordMatches) {
        if (DEFAULT_STOP_WORDS.has(token)) continue;
        if (/^\d+$/.test(token)) continue;
        pushTopic(token);
        if (topics.length >= 10) break;
    }

    return topics;
};

const scoreRecency = (createdAt) => {
    if (!createdAt) return 0;
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return 0;
    const ageHours = Math.max(0, (Date.now() - date.getTime()) / 36e5);
    return 35 * Math.exp(-ageHours / 18);
};

const scoreHotTweet = (tweet) => {
    const likes = Number(tweet?._count?.likes || 0);
    const comments = Number(tweet?._count?.comments || 0);
    const engagement = likes * 1.8 + comments * 2.4;
    return engagement + scoreRecency(tweet.createdAt);
};

const scoreForYouTweet = (tweet, profile) => {
    let score = scoreHotTweet(tweet);

    if (profile.followingSet.has(tweet.ownerId)) {
        score += 18;
    }

    const ownerAffinity = profile.ownerAffinity.get(tweet.ownerId) || 0;
    score += Math.min(ownerAffinity * 7, 20);

    const topics = extractTopicsFromTweetContent(tweet.content);
    let topicBoost = 0;
    for (const topic of topics) {
        topicBoost += profile.topicWeights.get(topic) || 0;
    }
    score += Math.min(topicBoost * 3.2, 28);

    if (tweet.ownerId === profile.userId) {
        score -= 8;
    }

    return score;
};

const TWEET_OWNER_SELECT = {
    id: true,
    username: true,
    fullName: true,
    avatar: true,
};

const TWEET_FEED_SELECT = {
    id: true,
    content: true,
    image: true,
    createdAt: true,
    ownerId: true,
    owner: {
        select: TWEET_OWNER_SELECT,
    },
    _count: {
        select: {
            likes: true,
            comments: true,
        },
    },
};

const normalizeNotClauses = (existingNot) => {
    if (!existingNot) return [];
    if (Array.isArray(existingNot)) return existingNot;
    return [existingNot];
};

const addNotInTweetIds = (where, tweetIds = []) => {
    const ids = [...new Set((tweetIds || []).filter(Boolean))];
    if (ids.length === 0) return where;

    const baseNot = normalizeNotClauses(where?.NOT);
    return {
        ...where,
        NOT: [...baseNot, { id: { in: ids } }],
    };
};

const appendRandomTweetBackfill = async ({
    currentTweets = [],
    limit = 0,
    skip = 0,
    primaryTotal = 0,
    baseWhere = {},
    orderBy = [{ createdAt: "desc" }],
    seedKey = "tweets:feed",
}) => {
    const safeCurrent = Array.isArray(currentTweets) ? [...currentTweets] : [];
    if (safeCurrent.length >= limit) {
        return {
            tweets: safeCurrent.slice(0, limit),
            usedBackfill: false,
            backfillCount: 0,
            fallbackTotal: 0,
        };
    }

    const backfillWhere = addNotInTweetIds(baseWhere, safeCurrent.map((tweet) => tweet?.id));
    const fallbackTotal = await prisma.tweet.count({ where: backfillWhere });
    if (fallbackTotal <= 0) {
        return {
            tweets: safeCurrent,
            usedBackfill: false,
            backfillCount: 0,
            fallbackTotal: 0,
        };
    }

    const remaining = Math.max(0, limit - safeCurrent.length);
    const poolTake = Math.min(resolveBackfillPoolTake(remaining), fallbackTotal);
    const fallbackSkip = resolveBackfillSkip({
        skip,
        primaryTotal,
        fallbackTotal,
    });

    const backfillPool = await prisma.tweet.findMany({
        where: backfillWhere,
        orderBy,
        skip: fallbackSkip,
        take: poolTake,
        select: TWEET_FEED_SELECT,
    });

    const dayKey = new Date().toISOString().slice(0, 10);
    const shuffled = seededShuffle(backfillPool, `${seedKey}:${dayKey}`);
    const appended = shuffled.slice(0, remaining);

    return {
        tweets: [...safeCurrent, ...appended],
        usedBackfill: appended.length > 0,
        backfillCount: appended.length,
        fallbackTotal,
    };
};

const formatTweetFeedItem = (tweet, likedTweetIds = null) => ({
    id: tweet.id,
    content: tweet.content,
    image: tweet.image,
    createdAt: tweet.createdAt,
    owner: tweet.owner || null,
    likesCount: tweet?._count?.likes || 0,
    commentsCount: tweet?._count?.comments || 0,
    isLikedByMe: likedTweetIds ? likedTweetIds.has(tweet.id) : false,
    topics: extractTopicsFromTweetContent(tweet.content).slice(0, 6),
});

const getBlockedChannelIds = async (userId) => {
    if (!userId) return [];
    const rows = await prisma.blockedChannel.findMany({
        where: { userId },
        select: { channelId: true },
        take: 500,
    });
    return rows.map((row) => row.channelId).filter(Boolean);
};

const buildTweetFeedWhere = ({ topic, blockedChannelIds = [] } = {}) => {
    const where = {
        isDeleted: false,
        owner: {
            is: buildPublicOwnerWhere(),
        },
    };

    const normalizedTopic = normalizeTopicText(topic);
    if (normalizedTopic) {
        where.content = {
            contains: normalizedTopic,
            mode: "insensitive",
        };
    }

    if (blockedChannelIds.length > 0) {
        where.ownerId = { notIn: blockedChannelIds };
    }

    return where;
};

const buildUserInterestProfile = async (userId) => {
    const [followingRows, recentLikedTweets, ownRecentTweets] = await Promise.all([
        prisma.subscription.findMany({
            where: { subscriberId: userId },
            select: { channelId: true },
            take: 500,
        }),
        prisma.like.findMany({
            where: {
                likedById: userId,
                tweetId: { not: null },
            },
            orderBy: { createdAt: "desc" },
            take: 160,
            select: {
                tweet: {
                    select: {
                        ownerId: true,
                        content: true,
                    },
                },
            },
        }),
        prisma.tweet.findMany({
            where: {
                ownerId: userId,
                isDeleted: false,
            },
            orderBy: { createdAt: "desc" },
            take: 40,
            select: {
                ownerId: true,
                content: true,
            },
        }),
    ]);

    const followingSet = new Set(
        followingRows.map((row) => row.channelId).filter(Boolean)
    );

    const ownerAffinity = new Map();
    const topicWeights = new Map();

    const registerTweet = (tweet, weight = 1) => {
        if (!tweet) return;
        if (tweet.ownerId) {
            ownerAffinity.set(
                tweet.ownerId,
                (ownerAffinity.get(tweet.ownerId) || 0) + weight
            );
        }

        const topics = extractTopicsFromTweetContent(tweet.content);
        for (const topic of topics) {
            topicWeights.set(topic, (topicWeights.get(topic) || 0) + weight);
        }
    };

    for (const row of recentLikedTweets) {
        registerTweet(row.tweet, 1.2);
    }

    for (const tweet of ownRecentTweets) {
        registerTweet(tweet, 0.7);
    }

    return {
        userId,
        followingSet,
        ownerAffinity,
        topicWeights,
    };
};

const enrichWithLikedState = async (tweets, userId) => {
    if (!userId || tweets.length === 0) return null;
    const tweetIds = tweets.map((tweet) => tweet.id);
    const rows = await prisma.like.findMany({
        where: {
            likedById: userId,
            tweetId: { in: tweetIds },
        },
        select: {
            tweetId: true,
        },
    });
    return new Set(rows.map((row) => row.tweetId).filter(Boolean));
};

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
            tweetPreview: content.slice(0, 160),
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

export const getTweetFeed = asyncHandler(async (req, res) => {
    const userId = req.user?.id || null;
    const mode = resolveTweetFeedMode(req.query?.mode, userId);
    const topic = normalizeTopicText(req.query?.topic || "");
    const page = parsePositiveInt(req.query?.page, 1);
    const limit = parsePositiveInt(req.query?.limit, DEFAULT_FEED_LIMIT, MAX_FEED_LIMIT);
    const skip = (page - 1) * limit;
    const sortType = normalizeText(req.query?.sortType).toLowerCase() === "asc" ? "asc" : "desc";

    if (mode === "following" && !userId) {
        throw new ApiError(401, "Login required for following feed");
    }

    const blockedChannelIds = await getBlockedChannelIds(userId);
    const shouldUseCache = page <= 3;
    const cacheParams = shouldUseCache
        ? {
            mode,
            page,
            limit,
            topic: topic || null,
            sortType,
            userId: userId || "anon",
          }
        : null;

    if (cacheParams) {
        const cached = await getCachedValue({
            scope: "tweets:feed",
            params: cacheParams,
        });

        if (cached.hit && cached.value) {
            return res.status(200).json(
                new ApiResponse(200, cached.value.data, cached.value.message)
            );
        }
    }

    const baseWhere = buildTweetFeedWhere({ topic, blockedChannelIds });

    let tweets = [];
    let totalItems = 0;
    let ranking = "chronological";
    let followingChannelsCount = 0;
    let usedBackfill = false;
    let backfillCount = 0;

    if (mode === "following") {
        const followingRows = await prisma.subscription.findMany({
            where: { subscriberId: userId },
            select: { channelId: true },
            take: 500,
        });
        const followingIds = followingRows.map((row) => row.channelId).filter(Boolean);
        followingChannelsCount = followingIds.length;

        const allowedFollowingIds = blockedChannelIds.length > 0
            ? followingIds.filter((id) => !blockedChannelIds.includes(id))
            : followingIds;

        if (allowedFollowingIds.length > 0) {
            const where = {
                ...baseWhere,
                ownerId: {
                    in: allowedFollowingIds,
                },
            };

            const [rows, count] = await Promise.all([
                prisma.tweet.findMany({
                    where,
                    orderBy: {
                        createdAt: sortType,
                    },
                    skip,
                    take: limit,
                    select: TWEET_FEED_SELECT,
                }),
                prisma.tweet.count({ where }),
            ]);

            tweets = rows;
            totalItems = count;
        }
    } else if (mode === "latest") {
        const [rows, count] = await Promise.all([
            prisma.tweet.findMany({
                where: baseWhere,
                orderBy: {
                    createdAt: sortType,
                },
                skip,
                take: limit,
                select: TWEET_FEED_SELECT,
            }),
            prisma.tweet.count({ where: baseWhere }),
        ]);

        tweets = rows;
        totalItems = count;
    } else if (mode === "hot") {
        ranking = "engagement+recency";
        const [rows, count] = await Promise.all([
            prisma.tweet.findMany({
                where: baseWhere,
                orderBy: [
                    { likes: { _count: "desc" } },
                    { comments: { _count: "desc" } },
                    { createdAt: "desc" },
                ],
                skip,
                take: limit,
                select: TWEET_FEED_SELECT,
            }),
            prisma.tweet.count({ where: baseWhere }),
        ]);

        tweets = [...rows].sort((a, b) => scoreHotTweet(b) - scoreHotTweet(a));
        if (sortType === "asc") {
            tweets.reverse();
        }
        totalItems = count;
    } else {
        ranking = "personalized";
        if (skip >= 500) {
            const [rows, count] = await Promise.all([
                prisma.tweet.findMany({
                    where: baseWhere,
                    orderBy: {
                        createdAt: "desc",
                    },
                    skip,
                    take: limit,
                    select: TWEET_FEED_SELECT,
                }),
                prisma.tweet.count({ where: baseWhere }),
            ]);

            tweets = rows;
            totalItems = count;
            ranking = "personalized-fallback";
            followingChannelsCount = 0;
        } else {
            const profile = await buildUserInterestProfile(userId);
            const candidateTake = Math.min(
                DEFAULT_FOR_YOU_CANDIDATE_SIZE + skip + limit * 3,
                500
            );

            const [candidateRows, count] = await Promise.all([
                prisma.tweet.findMany({
                    where: baseWhere,
                    orderBy: [
                        { createdAt: "desc" },
                        { likes: { _count: "desc" } },
                    ],
                    take: candidateTake,
                    select: TWEET_FEED_SELECT,
                }),
                prisma.tweet.count({ where: baseWhere }),
            ]);

            const ranked = candidateRows
                .map((tweet) => ({
                    tweet,
                    score: scoreForYouTweet(tweet, profile),
                }))
                .sort((a, b) => b.score - a.score)
                .map((entry) => entry.tweet);

            tweets = ranked.slice(skip, skip + limit);
            if (sortType === "asc") {
                tweets.reverse();
            }
            totalItems = count;
            followingChannelsCount = profile.followingSet.size;
        }
    }

    if (tweets.length < limit) {
        const backfill = await appendRandomTweetBackfill({
            currentTweets: tweets,
            limit,
            skip,
            primaryTotal: totalItems,
            baseWhere,
            orderBy: [{ createdAt: "desc" }],
            seedKey: `tweets:feed:${mode}:${userId || "anon"}:${page}:${limit}:${topic || "all"}:${sortType}`,
        });

        tweets = backfill.tweets;
        usedBackfill = backfill.usedBackfill;
        backfillCount = backfill.backfillCount;
        totalItems = Math.max(totalItems, backfill.fallbackTotal, skip + tweets.length);
        if (usedBackfill) {
            ranking = `${ranking}+backfill`;
        }
    }

    const likedTweetIds = await enrichWithLikedState(tweets, userId);
    const formattedTweets = tweets.map((tweet) =>
        formatTweetFeedItem(tweet, likedTweetIds)
    );

    const responseData = buildPaginatedListData({
        items: formattedTweets,
        currentPage: page,
        limit,
        totalItems,
        extra: {
            mode,
            filters: {
                topic: topic || null,
            },
            ranking,
            followingChannelsCount,
            blockedChannels: blockedChannelIds.length,
            usedBackfill,
            backfillCount,
        },
    });

    const responseMessage = "Tweet feed fetched successfully";

    if (cacheParams) {
        await setCachedValue({
            scope: "tweets:feed",
            params: cacheParams,
            value: {
                data: responseData,
                message: responseMessage,
            },
            ttlSeconds: FEED_CACHE_TTL_SECONDS,
        });
    }

    return res.status(200).json(
        new ApiResponse(200, responseData, responseMessage)
    );
});

export const getHotTweetTopics = asyncHandler(async (req, res) => {
    const userId = req.user?.id || null;
    const q = normalizeTopicText(req.query?.q || "");
    const limit = parsePositiveInt(
        req.query?.limit,
        DEFAULT_HOT_TOPICS_LIMIT,
        MAX_HOT_TOPICS_LIMIT
    );
    const windowHours = parsePositiveInt(
        req.query?.windowHours,
        DEFAULT_TOPICS_WINDOW_HOURS,
        MAX_TOPICS_WINDOW_HOURS
    );

    const blockedChannelIds = await getBlockedChannelIds(userId);
    const cacheParams = {
        q: q || null,
        limit,
        windowHours,
        userId: userId || "anon",
    };

    const cached = await getCachedValue({
        scope: "tweets:hot-topics",
        params: cacheParams,
    });

    if (cached.hit && cached.value) {
        return res.status(200).json(
            new ApiResponse(200, cached.value.data, cached.value.message)
        );
    }

    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const where = buildTweetFeedWhere({ blockedChannelIds });
    where.createdAt = { gte: since };

    const recentTweets = await prisma.tweet.findMany({
        where,
        orderBy: {
            createdAt: "desc",
        },
        take: 1200,
        select: {
            id: true,
            content: true,
            createdAt: true,
            _count: {
                select: {
                    likes: true,
                    comments: true,
                },
            },
        },
    });

    const topicMap = new Map();

    for (const tweet of recentTweets) {
        const topics = extractTopicsFromTweetContent(tweet.content);
        if (topics.length === 0) continue;

        const uniqueTopics = Array.from(new Set(topics));
        const tweetHotScore = scoreHotTweet(tweet);
        const tweetEngagement = Number(tweet?._count?.likes || 0) + Number(tweet?._count?.comments || 0);

        for (const topic of uniqueTopics) {
            if (q && !topic.includes(q)) continue;

            const prev = topicMap.get(topic) || {
                topic,
                displayName: `#${topic}`,
                slug: topic.replace(/_/g, "-"),
                mentions: 0,
                engagement: 0,
                trendScore: 0,
                sampleTweetIds: [],
            };

            prev.mentions += 1;
            prev.engagement += tweetEngagement;
            prev.trendScore += tweetHotScore;

            if (prev.sampleTweetIds.length < 4) {
                prev.sampleTweetIds.push(tweet.id);
            }

            topicMap.set(topic, prev);
        }
    }

    const items = Array.from(topicMap.values())
        .map((entry) => ({
            ...entry,
            trendScore: Number(entry.trendScore.toFixed(3)),
        }))
        .sort((a, b) => {
            if (b.trendScore !== a.trendScore) return b.trendScore - a.trendScore;
            if (b.mentions !== a.mentions) return b.mentions - a.mentions;
            return b.engagement - a.engagement;
        })
        .slice(0, limit);

    const responseData = {
        windowHours,
        generatedAt: new Date().toISOString(),
        items,
    };
    const responseMessage = "Hot tweet topics fetched successfully";

    await setCachedValue({
        scope: "tweets:hot-topics",
        params: cacheParams,
        value: {
            data: responseData,
            message: responseMessage,
        },
        ttlSeconds: HOT_TOPICS_CACHE_TTL_SECONDS,
    });

    return res.status(200).json(
        new ApiResponse(200, responseData, responseMessage)
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
    const userId = req.user?.id || null;

    if (!tweetId) {
        throw new ApiError(400, "Tweet ID is required");
    }

    const tweet = await prisma.tweet.findFirst({
        where: {
            id: tweetId,
            isDeleted: false,
            owner: {
                is: buildPublicOwnerWhere(),
            },
        },
        select: {
            id: true,
            content: true,
            image: true,
            createdAt: true,
            ownerId: true,
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

    if (!tweet) {
        throw new ApiError(404, "Tweet not found");
    }

    let isLikedByMe = false;
    if (userId) {
        const like = await prisma.like.findUnique({
            where: {
                likedById_tweetId: {
                    likedById: userId,
                    tweetId,
                },
            },
            select: { id: true },
        });
        isLikedByMe = Boolean(like);
    }

    const payload = {
        id: tweet.id,
        content: tweet.content,
        image: tweet.image,
        createdAt: tweet.createdAt,
        owner: tweet.owner || null,
        likesCount: tweet?._count?.likes || 0,
        commentsCount: tweet?._count?.comments || 0,
        isLikedByMe,
        topics: extractTopicsFromTweetContent(tweet.content).slice(0, 6),
    };

    return res.status(200).json(
        new ApiResponse(200, payload, "Tweet fetched successfully")
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


