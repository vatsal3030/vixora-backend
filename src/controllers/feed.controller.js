import prisma from "../db/prisma.js";
import asyncHandler from "../utils/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import ApiError from "../utils/ApiError.js";
import { getCachedValue, setCachedValue } from "../utils/cache.js";
import { sanitizePagination } from "../utils/pagination.js";
import { sanitizeSort } from "../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../utils/listResponse.js";

const BASE_AVAILABLE_VIDEO_WHERE = Object.freeze({
    isPublished: true,
    isDeleted: false,
    processingStatus: "COMPLETED",
    isHlsReady: true,
    owner: {
        is: {
            isDeleted: false
        }
    }
});

const MAX_PERSONALIZATION_HISTORY_ROWS = 300;
const MAX_INTERESTED_TAG_IDS = 100;
const MAX_SUPPRESSION_ROWS = 1000;

const buildBaseFeedVideoWhere = (extra = {}) => ({
    ...BASE_AVAILABLE_VIDEO_WHERE,
    ...extra
});

const HOME_FEED_SELECT = {
    id: true,
    title: true,
    thumbnail: true,
    duration: true,
    views: true,
    isShort: true,
    createdAt: true,
    owner: {
        select: {
            id: true,
            username: true,
            avatar: true
        }
    }
};

const HOME_CACHE_TTL_SECONDS = 20;
const SUBSCRIPTIONS_CACHE_TTL_SECONDS = 20;
const TRENDING_CACHE_TTL_SECONDS = 45;
const MAX_CACHEABLE_PAGE = 3;
const MAX_CACHEABLE_LIMIT = 20;

const isCacheableWindow = (page, limit) =>
    Number.isFinite(page) &&
    Number.isFinite(limit) &&
    page >= 1 &&
    page <= MAX_CACHEABLE_PAGE &&
    limit >= 1 &&
    limit <= MAX_CACHEABLE_LIMIT;

const parseBooleanQuery = (value) => {
    if (value === undefined || value === null || value === "") return undefined;

    const normalized = String(value).trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;

    return undefined;
};

const normalizeNotClauses = (existingNot) => {
    if (!existingNot) return [];
    if (Array.isArray(existingNot)) return existingNot;
    return [existingNot];
};

const addNotInVideoIds = (where, videoIds = []) => {
    const ids = [...new Set((videoIds || []).filter(Boolean))];
    if (ids.length === 0) return where;

    const baseNot = normalizeNotClauses(where?.NOT);
    return {
        ...where,
        NOT: [...baseNot, { id: { in: ids } }],
    };
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

const getSuppressionFilterForUser = async (userId) => {
    if (!userId) {
        return {
            whereExtra: {},
            blockedChannelIds: [],
            notInterestedVideoIds: [],
        };
    }

    const [notInterestedRows, blockedChannelRows] = await Promise.all([
        prisma.notInterested.findMany({
            where: { userId },
            take: MAX_SUPPRESSION_ROWS,
            orderBy: { createdAt: "desc" },
            select: { videoId: true },
        }),
        prisma.blockedChannel.findMany({
            where: { userId },
            take: MAX_SUPPRESSION_ROWS,
            orderBy: { createdAt: "desc" },
            select: { channelId: true },
        }),
    ]);

    const notInterestedVideoIds = [
        ...new Set(notInterestedRows.map((row) => row.videoId).filter(Boolean)),
    ];
    const blockedChannelIds = [
        ...new Set(blockedChannelRows.map((row) => row.channelId).filter(Boolean)),
    ];

    const NOT = [];
    if (notInterestedVideoIds.length > 0) {
        NOT.push({ id: { in: notInterestedVideoIds } });
    }
    if (blockedChannelIds.length > 0) {
        NOT.push({ ownerId: { in: blockedChannelIds } });
    }

    return {
        whereExtra: NOT.length > 0 ? { NOT } : {},
        blockedChannelIds,
        notInterestedVideoIds,
    };
};


/**
 * Helper: attach watch progress
 */
export const attachWatchProgress = async (videos, userId) => {
    if (!Array.isArray(videos)) {
        throw new ApiError(500, "Invalid video list provided to attachWatchProgress");
    }

    if (!userId || videos.length === 0) {
        return videos;
    }

    const videoIds = videos.map(v => v.id).filter(Boolean);

    if (videoIds.length === 0) return videos;

    const history = await prisma.watchHistory.findMany({
        where: {
            userId,
            videoId: { in: videoIds }
        },
        select: {
            videoId: true,
            progress: true,
            duration: true,
            completed: true
        }
    });

    const progressMap = {};
    for (const row of history) {
        progressMap[row.videoId] = {
            progress: row.progress,
            duration: row.duration,
            completed: row.completed
        };
    }

    return videos.map(video => ({
        ...video,
        watchProgress: progressMap[video.id] || null
    }));


};

/**
 * HOME FEED
 * Mix of recent + popular videos
 */
export const getHomeFeed = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "10",
        sortBy = "createdAt",
        sortType = "desc"
    } = req.query;

    const userId = req.user?.id || null;

    // -------------------------------
    // Pagination validation
    // -------------------------------
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);

    // -------------------------------
    // Sorting validation
    // -------------------------------
    const safeSort = sanitizeSort(
        sortBy,
        sortType,
        ["createdAt", "views"],
        "createdAt"
    );
    sortBy = safeSort.sortBy;
    sortType = safeSort.sortType;

    const shouldUseCache = Boolean(userId) && isCacheableWindow(safePage, safeLimit);
    const cacheParams = shouldUseCache
        ? { userId, page: safePage, limit: safeLimit, sortBy, sortType }
        : null;

    if (cacheParams) {
        const cached = await getCachedValue({
            scope: "feed:home",
            params: cacheParams,
        });

        if (cached.hit && cached.value) {
            return res.status(200).json(
                new ApiResponse(200, cached.value.data, cached.value.message)
            );
        }
    }

    // -------------------------------
    // Base filter
    // -------------------------------
    const suppression = await getSuppressionFilterForUser(userId);
    const whereClause = buildBaseFeedVideoWhere(suppression.whereExtra);

    // -------------------------------
    // Fetch videos
    // -------------------------------

    const watchedVideoTags = await prisma.watchHistory.findMany({
        where: {
            userId,
            video: {
                is: buildBaseFeedVideoWhere(suppression.whereExtra)
            }
        },
        orderBy: {
            lastWatchedAt: "desc"
        },
        take: MAX_PERSONALIZATION_HISTORY_ROWS,
        select: {
            video: {
                select: {
                    tags: { select: { tagId: true } }
                }
            }
        }
    });

    const interestedTagIds = [
        ...new Set(
            watchedVideoTags.flatMap(v =>
                (v.video?.tags || []).map(t => t.tagId)
            )
        )
    ].slice(0, MAX_INTERESTED_TAG_IDS);

    const subscriptions = await prisma.subscription.findMany({
        where: {
            subscriberId: userId,
            channel: {
                isDeleted: false,
                ...(suppression.blockedChannelIds.length > 0 && {
                    id: {
                        notIn: suppression.blockedChannelIds,
                    },
                }),
            }
        },
        select: { channelId: true }
    });

    const subscribedChannelIds = subscriptions.map(s => s.channelId);



    const personalizedOrClauses = [];
    if (subscribedChannelIds.length > 0) {
        personalizedOrClauses.push({ ownerId: { in: subscribedChannelIds } });
    }
    if (interestedTagIds.length > 0) {
        personalizedOrClauses.push({ tags: { some: { tagId: { in: interestedTagIds } } } });
    }

    const personalizedWhereClause =
        personalizedOrClauses.length > 0
            ? {
                ...whereClause,
                OR: personalizedOrClauses
            }
            : null;

    const fallbackOrderBy =
        sortBy === "createdAt"
            ? [{ createdAt: sortType }]
            : [{ [sortBy]: sortType }, { createdAt: "desc" }];

    let videos = [];
    let personalizedCount = 0;
    let usedBackfill = false;

    if (personalizedWhereClause) {
        videos = await prisma.video.findMany({
            where: personalizedWhereClause,
            orderBy: [
                { popularityScore: "desc" },
                { createdAt: "desc" }
            ],
            skip,
            take: safeLimit,
            select: HOME_FEED_SELECT
        });

        // We still return full feed pagination/count and not only personalized subset.
        personalizedCount = await prisma.video.count({
            where: personalizedWhereClause,
        });
    }

    // Backfill with exploration candidates when personalized pool is insufficient.
    if (videos.length < safeLimit) {
        const remaining = safeLimit - videos.length;
        const alreadyAddedIds = videos.map((row) => row.id);

        const exploreSkip = Math.max(0, skip - personalizedCount);
        const explorePoolTake = Math.max(remaining * 4, 24);
        const backfillWhere = addNotInVideoIds(whereClause, alreadyAddedIds);

        const backfillPool = await prisma.video.findMany({
            where: backfillWhere,
            orderBy: fallbackOrderBy,
            skip: exploreSkip,
            take: explorePoolTake,
            select: HOME_FEED_SELECT,
        });

        // Deterministic shuffle gives diversity while remaining cache-friendly.
        const dayKey = new Date().toISOString().slice(0, 10);
        const shuffledBackfill = seededShuffle(
            backfillPool,
            `${userId || "anon"}:${safePage}:${safeLimit}:${dayKey}`
        );

        videos = [...videos, ...shuffledBackfill.slice(0, remaining)];
        usedBackfill = true;
    } else if (personalizedWhereClause && videos.length === safeLimit && safeLimit >= 5) {
        // Even with strong personalization, keep a small exploration slice
        // to avoid overfitting and improve discovery.
        const exploreCount = Math.max(1, Math.floor(safeLimit * 0.2));
        const backfillWhere = addNotInVideoIds(whereClause, videos.map((row) => row.id));
        const explorePool = await prisma.video.findMany({
            where: backfillWhere,
            orderBy: fallbackOrderBy,
            skip,
            take: Math.max(exploreCount * 4, 12),
            select: HOME_FEED_SELECT,
        });

        if (explorePool.length > 0) {
            const dayKey = new Date().toISOString().slice(0, 10);
            const exploration = seededShuffle(
                explorePool,
                `${userId || "anon"}:${safePage}:${safeLimit}:explore:${dayKey}`
            ).slice(0, exploreCount);

            if (exploration.length > 0) {
                const keepCount = Math.max(0, safeLimit - exploration.length);
                videos = [...videos.slice(0, keepCount), ...exploration];
                usedBackfill = true;
            }
        }
    }


    // -------------------------------
    // Attach watch progress
    // -------------------------------
    const videosWithProgress = await attachWatchProgress(videos, userId);

    // -------------------------------
    // Total count for pagination
    // -------------------------------
    const totalVideos = await prisma.video.count({
        where: whereClause
    });

    const responseData = buildPaginatedListData({
        items: videosWithProgress,
        currentPage: safePage,
        limit: safeLimit,
        totalItems: totalVideos,
        extra: {
            filters: {
                sortBy,
                sortType,
                blockedChannels: suppression.blockedChannelIds.length,
                hiddenVideos: suppression.notInterestedVideoIds.length,
                personalizedMatches: personalizedCount,
                usedBackfill,
            }
        }
    });

    const responseMessage = "Home feed fetched successfully";

    if (cacheParams) {
        await setCachedValue({
            scope: "feed:home",
            params: cacheParams,
            value: { data: responseData, message: responseMessage },
            ttlSeconds: HOME_CACHE_TTL_SECONDS,
        });
    }

    return res.status(200).json(
        new ApiResponse(200, responseData, responseMessage)
    );
});


/**
 * SUBSCRIPTIONS FEED
 */
export const getSubscriptionsFeed = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    if (!userId) {
        throw new ApiError(401, "Unauthorized");
    }

    let {
        page = "1",
        limit = "10",
        isShort = "false"
    } = req.query;

    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);

    // Convert isShort safely
    const isShortFilter = parseBooleanQuery(isShort);

    const shouldUseCache = isCacheableWindow(safePage, safeLimit);
    const cacheParams = shouldUseCache
        ? { userId, page: safePage, limit: safeLimit, isShort: isShortFilter ?? "all" }
        : null;

    if (cacheParams) {
        const cached = await getCachedValue({
            scope: "feed:subscriptions",
            params: cacheParams,
        });

        if (cached.hit && cached.value) {
            return res.status(200).json(
                new ApiResponse(200, cached.value.data, cached.value.message)
            );
        }
    }

    // 1️⃣ Get subscribed channels
    const suppression = await getSuppressionFilterForUser(userId);

    const subscriptions = await prisma.subscription.findMany({
        where: {
            subscriberId: userId,
            channel: {
                isDeleted: false,
                ...(suppression.blockedChannelIds.length > 0 && {
                    id: {
                        notIn: suppression.blockedChannelIds,
                    },
                }),
            }
        },
        select: { channelId: true }
    });

    if (!subscriptions.length) {
        const emptyData = buildPaginatedListData({
            items: [],
            currentPage: safePage,
            limit: safeLimit,
            totalItems: 0,
            extra: {
                filters: {
                    isShort: isShortFilter ?? null
                }
            }
        });

        if (cacheParams) {
            await setCachedValue({
                scope: "feed:subscriptions",
                params: cacheParams,
                value: { data: emptyData, message: "No subscriptions found" },
                ttlSeconds: SUBSCRIPTIONS_CACHE_TTL_SECONDS,
            });
        }

        return res.status(200).json(
            new ApiResponse(200, emptyData, "No subscriptions found")
        );
    }

    const channelIds = subscriptions.map(s => s.channelId);

    // 2️⃣ Build video filter
    const videoWhere = buildBaseFeedVideoWhere({
        ownerId: { in: channelIds },
        ...suppression.whereExtra,
        ...(isShortFilter !== undefined && { isShort: isShortFilter })
    });


    // 3️⃣ Fetch videos
    let videos = await prisma.video.findMany({
        where: videoWhere,
        orderBy: { createdAt: "desc" },
        skip,
        take: safeLimit,
        select: {
            id: true,
            title: true,
            thumbnail: true,
            duration: true,
            views: true,
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

    // 4️⃣ Attach watch progress
    const videosWithProgress = await attachWatchProgress(videos, userId);

    // 5️⃣ Total count
    const totalVideos = await prisma.video.count({
        where: videoWhere
    });

    const responseData = buildPaginatedListData({
        items: videosWithProgress,
        currentPage: safePage,
        limit: safeLimit,
        totalItems: totalVideos,
        extra: {
            filters: {
                isShort: isShortFilter ?? null,
                blockedChannels: suppression.blockedChannelIds.length,
                hiddenVideos: suppression.notInterestedVideoIds.length,
            }
        }
    });

    const responseMessage = "Subscription feed fetched successfully";

    if (cacheParams) {
        await setCachedValue({
            scope: "feed:subscriptions",
            params: cacheParams,
            value: { data: responseData, message: responseMessage },
            ttlSeconds: SUBSCRIPTIONS_CACHE_TTL_SECONDS,
        });
    }

    return res.status(200).json(
        new ApiResponse(200, responseData, responseMessage)
    );
});

/**
 * TRENDING FEED
 */
export const getTrendingFeed = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "20",
        isShort = "false",
        sortBy = "views",
        sortType = "desc"
    } = req.query;

    // --------------------------
    // Pagination
    // --------------------------
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);

    // --------------------------
    // Boolean conversion
    // --------------------------
    const isShortFilter = parseBooleanQuery(isShort);

    const safeSort = sanitizeSort(
        sortBy,
        sortType,
        ["views", "createdAt"],
        "views"
    );
    sortBy = safeSort.sortBy;
    sortType = safeSort.sortType;

    const shouldUseCache = isCacheableWindow(safePage, safeLimit);
    const cacheParams = shouldUseCache
        ? {
            page: safePage,
            limit: safeLimit,
            isShort: isShortFilter ?? "all",
            sortBy,
            sortType
        }
        : null;

    if (cacheParams) {
        const cached = await getCachedValue({
            scope: "feed:trending",
            params: cacheParams,
        });

        if (cached.hit && cached.value) {
            return res.status(200).json(
                new ApiResponse(200, cached.value.data, cached.value.message)
            );
        }
    }

    const userId = req.user?.id || null;
    const suppression = await getSuppressionFilterForUser(userId);

    // --------------------------
    // Where clause
    // --------------------------
    const whereClause = buildBaseFeedVideoWhere({
        ...suppression.whereExtra,
        ...(isShortFilter !== undefined && { isShort: isShortFilter })
    });

    // --------------------------
    // Fetch videos
    // --------------------------
    let videos = await prisma.video.findMany({
        where: whereClause,
        orderBy:
            sortBy === "createdAt"
                ? [{ createdAt: sortType }]
                : [{ [sortBy]: sortType }, { createdAt: "desc" }],
        skip,
        take: safeLimit,
        select: {
            id: true,
            title: true,
            thumbnail: true,
            duration: true,
            views: true,
            createdAt: true,
            isShort: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true
                }
            }
        }
    });

    // --------------------------
    // Total count
    // --------------------------
    const totalVideos = await prisma.video.count({
        where: whereClause
    });

    const responseData = buildPaginatedListData({
        items: videos,
        currentPage: safePage,
        limit: safeLimit,
        totalItems: totalVideos,
        extra: {
            filters: {
                isShort: isShortFilter ?? null,
                sortBy,
                sortType,
                blockedChannels: suppression.blockedChannelIds.length,
                hiddenVideos: suppression.notInterestedVideoIds.length,
            }
        }
    });

    const responseMessage = "Trending feed fetched successfully";

    if (cacheParams) {
        await setCachedValue({
            scope: "feed:trending",
            params: cacheParams,
            value: { data: responseData, message: responseMessage },
            ttlSeconds: TRENDING_CACHE_TTL_SECONDS,
        });
    }

    return res.status(200).json(
        new ApiResponse(200, responseData, responseMessage)
    );
});


/**
 * SHORTS FEED
 */
export const getShortsFeed = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "20",
        sortBy = "createdAt",
        sortType = "desc",
        includeComments = "true",
        commentsLimit = "5"
    } = req.query;

    const userId = req.user?.id || null;

    // Pagination safety
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 50);
    const safeSort = sanitizeSort(
        sortBy,
        sortType,
        ["createdAt", "views"],
        "createdAt"
    );
    sortBy = safeSort.sortBy;
    sortType = safeSort.sortType;

    const includeCommentsFlag = parseBooleanQuery(includeComments) !== false;
    const parsedCommentsLimit = Number.parseInt(commentsLimit, 10);
    const safeCommentsLimit =
        Number.isInteger(parsedCommentsLimit) && parsedCommentsLimit > 0
            ? Math.min(parsedCommentsLimit, 10)
            : 5;

    const suppression = await getSuppressionFilterForUser(userId);

    // Fetch shorts
    const shorts = await prisma.video.findMany({
        where: buildBaseFeedVideoWhere({
            ...suppression.whereExtra,
            isShort: true,
        }),
        orderBy:
            sortBy === "createdAt"
                ? { createdAt: sortType }
                : [{ [sortBy]: sortType }, { createdAt: "desc" }],
        skip,
        take: safeLimit,
        select: {
            id: true,
            title: true,
            description: true,
            thumbnail: true,
            videoFile: true,
            playbackUrl: true,
            duration: true,
            views: true,
            createdAt: true,
            owner: {
                select: {
                    id: true,
                    fullName: true,
                    username: true,
                    avatar: true
                }
            },
            _count: {
                select: {
                    likes: true,
                    comments: true
                }
            },
            ...(userId && {
                likes: {
                    where: { likedById: userId },
                    select: { id: true }
                }
            }),
            ...(includeCommentsFlag && {
                comments: {
                where: {
                    isDeleted: false
                },
                take: safeCommentsLimit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    content: true,
                    createdAt: true,
                    owner: {
                        select: {
                            id: true,
                            fullName: true,
                            avatar: true
                        }
                    }
                }
            }})
        }
    });

    // Format shorts with interaction data
    const formattedShorts = shorts.map(short => ({
        ...short,
        playbackUrl: short.playbackUrl || short.videoFile,
        likesCount: short._count.likes,
        commentsCount: short._count.comments,
        isLiked: userId ? (short.likes?.length || 0) > 0 : false,
        _count: undefined,
        likes: undefined,
        videoFile: undefined
    }));

    // Attach watch progress
    const shortsWithProgress = await attachWatchProgress(formattedShorts, userId);

    // Count for pagination
    const totalShorts = await prisma.video.count({
        where: buildBaseFeedVideoWhere({
            ...suppression.whereExtra,
            isShort: true
        })
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                items: shortsWithProgress,
                currentPage: safePage,
                limit: safeLimit,
                totalItems: totalShorts,
                extra: {
                    filters: {
                        sortBy,
                        sortType,
                        includeComments: includeCommentsFlag,
                        commentsLimit: includeCommentsFlag ? safeCommentsLimit : 0,
                        blockedChannels: suppression.blockedChannelIds.length,
                        hiddenVideos: suppression.notInterestedVideoIds.length,
                    }
                }
            }),
            "Shorts feed fetched successfully"
        )
    );
});

