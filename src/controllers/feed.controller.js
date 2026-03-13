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
const MAX_TAG_DISCOVERY_VIDEOS = 500;
const MAX_TAG_SIGNAL_ROWS = 300;
const TAGS_DEFAULT_LIMIT = 30;
const TAGS_MAX_LIMIT = 100;
const TAG_FEED_DEFAULT_LIMIT = 20;
const TAG_FEED_MAX_LIMIT = 100;
const HOME_FEED_DEFAULT_LIMIT = 20;
const SUBSCRIPTIONS_FEED_DEFAULT_LIMIT = 20;
const TRENDING_FEED_DEFAULT_LIMIT = 30;
const SHORTS_FEED_DEFAULT_LIMIT = 30;
const FEED_PAGINATION_MAX_LIMIT = 100;
const FEED_BACKFILL_POOL_MULTIPLIER = 6;
const FEED_BACKFILL_MIN_POOL_SIZE = 24;
const MAX_TAG_NAME_LENGTH = 30;
const MAX_SEED_TOPICS = 25;
const FALLBACK_FEED_TAG_TOPICS = Object.freeze([
    "music",
    "gaming",
    "tech",
    "live",
    "news",
    "movies",
]);

const buildBaseFeedVideoWhere = (extra = {}) => ({
    ...BASE_AVAILABLE_VIDEO_WHERE,
    ...extra
});

const FEED_VIDEO_SELECT = {
    id: true,
    title: true,
    thumbnail: true,
    duration: true,
    views: true,
    isShort: true,
    createdAt: true,
    popularityScore: true,
    engagementScore: true,
    tags: {
        select: {
            tag: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    },
    categories: {
        select: {
            category: {
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    icon: true,
                },
            },
        },
    },
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
const TAGS_CACHE_TTL_SECONDS = 30;
const TAG_FEED_CACHE_TTL_SECONDS = 20;
const MAX_CACHEABLE_PAGE = 3;
const MAX_CACHEABLE_LIMIT = 40;

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

const parseFeedTopicInput = (value) => {
    if (value === undefined || value === null || value === "") return [];

    const rawEntries = Array.isArray(value)
        ? value
        : String(value).split(",");

    const topics = [];
    const seen = new Set();

    for (const entry of rawEntries) {
        const normalized = normalizeTagName(entry);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        topics.push(normalized);
        if (topics.length >= MAX_SEED_TOPICS) break;
    }

    return topics;
};

const getDefaultFeedTopicNames = () => {
    const fromEnv = parseFeedTopicInput(process.env.DEFAULT_FEED_TOPICS);
    if (fromEnv.length > 0) return fromEnv;
    return [...FALLBACK_FEED_TAG_TOPICS];
};

const normalizeTagName = (value) =>
    String(value ?? "")
        .trim()
        .toLowerCase()
        .slice(0, MAX_TAG_NAME_LENGTH);

const toDisplayTagName = (value) =>
    String(value || "")
        .split(/[\s_-]+/)
        .map((chunk) =>
            chunk ? chunk.charAt(0).toUpperCase() + chunk.slice(1) : chunk
        )
        .join(" ")
        .trim();

const computeFreshnessComponent = (createdAt, decayDays = 30) => {
    const timestamp = new Date(createdAt).getTime();
    if (!Number.isFinite(timestamp)) return 0;
    const ageDays = Math.max(0, (Date.now() - timestamp) / 86400000);
    const freshness = Math.max(0, 1 - ageDays / decayDays);
    return freshness * 25;
};

const computeVideoTrendScore = (video) => {
    const popularity = Number(video?.popularityScore || 0);
    const engagement = Number(video?.engagementScore || 0);
    const views = Number(video?.views || 0);

    return (
        popularity * 0.55 +
        engagement * 0.2 +
        Math.log10(views + 1) * 4 +
        computeFreshnessComponent(video?.createdAt)
    );
};

const flattenVideoTopics = (video) => {
    const tags = Array.isArray(video?.tags)
        ? video.tags
            .map((row) => row?.tag?.name)
            .filter(Boolean)
        : [];

    const categories = Array.isArray(video?.categories)
        ? video.categories
            .map((row) => row?.category)
            .filter((row) => row?.id)
        : [];

    return {
        ...video,
        tags,
        categories,
    };
};

const flattenVideoTopicsList = (videos = []) =>
    (Array.isArray(videos) ? videos : []).map((row) => flattenVideoTopics(row));

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

const resolveBackfillPoolTake = (needed) =>
    Math.max((Number(needed) || 0) * FEED_BACKFILL_POOL_MULTIPLIER, FEED_BACKFILL_MIN_POOL_SIZE);

const resolveBackfillSkip = ({ skip = 0, primaryTotal = 0, fallbackTotal = 0 }) => {
    const adjusted = Math.max(0, Number(skip || 0) - Math.max(0, Number(primaryTotal || 0)));
    const total = Math.max(0, Number(fallbackTotal || 0));
    if (total <= 0) return 0;
    return adjusted >= total ? adjusted % total : adjusted;
};

const appendRandomVideoBackfill = async ({
    currentVideos = [],
    take = 0,
    skip = 0,
    primaryTotal = 0,
    whereClause = {},
    orderBy = [{ createdAt: "desc" }],
    seedKey = "feed",
    select = FEED_VIDEO_SELECT,
}) => {
    const safeCurrent = Array.isArray(currentVideos) ? [...currentVideos] : [];
    if (safeCurrent.length >= take) {
        return {
            videos: safeCurrent.slice(0, take),
            usedBackfill: false,
            backfillCount: 0,
            fallbackTotal: 0,
        };
    }

    const excludedIds = safeCurrent.map((row) => row?.id).filter(Boolean);
    const backfillWhere = addNotInVideoIds(whereClause, excludedIds);
    const fallbackTotal = await prisma.video.count({ where: backfillWhere });
    if (fallbackTotal <= 0) {
        return {
            videos: safeCurrent,
            usedBackfill: false,
            backfillCount: 0,
            fallbackTotal: 0,
        };
    }

    const remaining = Math.max(0, take - safeCurrent.length);
    const poolTake = Math.min(resolveBackfillPoolTake(remaining), fallbackTotal);
    const fallbackSkip = resolveBackfillSkip({
        skip,
        primaryTotal,
        fallbackTotal,
    });

    const fallbackPool = await prisma.video.findMany({
        where: backfillWhere,
        orderBy,
        skip: fallbackSkip,
        take: poolTake,
        select,
    });

    const dayKey = new Date().toISOString().slice(0, 10);
    const shuffledBackfill = seededShuffle(fallbackPool, `${seedKey}:${dayKey}`);
    const appended = shuffledBackfill.slice(0, remaining);

    return {
        videos: [...safeCurrent, ...appended],
        usedBackfill: appended.length > 0,
        backfillCount: appended.length,
        fallbackTotal,
    };
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

const isPersonalizationEnabledForUser = async (userId) => {
    if (!userId) return false;

    const settings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { personalizeRecommendations: true },
    });

    return settings?.personalizeRecommendations !== false;
};

const buildVideoTagIdMap = async (videoIds = []) => {
    const ids = [...new Set((videoIds || []).filter(Boolean))];
    if (ids.length === 0) return new Map();

    const rows = await prisma.videoTag.findMany({
        where: {
            videoId: {
                in: ids,
            },
        },
        select: {
            videoId: true,
            tagId: true,
        },
    });

    const map = new Map();
    for (const row of rows) {
        if (!map.has(row.videoId)) map.set(row.videoId, []);
        map.get(row.videoId).push(row.tagId);
    }

    return map;
};

const buildUserTagInterestMap = async ({ userId, suppression }) => {
    if (!userId) return new Map();

    const videoFilter = buildBaseFeedVideoWhere(suppression?.whereExtra || {});

    const [watchRows, likeRows, hiddenRows] = await Promise.all([
        prisma.watchHistory.findMany({
            where: {
                userId,
                video: {
                    is: videoFilter,
                },
            },
            orderBy: {
                lastWatchedAt: "desc",
            },
            take: MAX_TAG_SIGNAL_ROWS,
            select: {
                videoId: true,
                progress: true,
                completed: true,
                lastWatchedAt: true,
            },
        }),
        prisma.like.findMany({
            where: {
                likedById: userId,
                videoId: {
                    not: null,
                },
                video: {
                    is: videoFilter,
                },
            },
            orderBy: {
                createdAt: "desc",
            },
            take: MAX_TAG_SIGNAL_ROWS,
            select: {
                videoId: true,
                createdAt: true,
            },
        }),
        prisma.notInterested.findMany({
            where: {
                userId,
            },
            orderBy: {
                createdAt: "desc",
            },
            take: MAX_TAG_SIGNAL_ROWS,
            select: {
                videoId: true,
                createdAt: true,
            },
        }),
    ]);

    const videoTagMap = await buildVideoTagIdMap([
        ...watchRows.map((row) => row.videoId),
        ...likeRows.map((row) => row.videoId).filter(Boolean),
        ...hiddenRows.map((row) => row.videoId).filter(Boolean),
    ]);

    const bump = (map, tagId, delta) => {
        if (!tagId || !Number.isFinite(delta) || delta === 0) return;
        map.set(tagId, (map.get(tagId) || 0) + delta);
    };

    const interestMap = new Map();

    for (const row of watchRows) {
        const tagIds = videoTagMap.get(row.videoId) || [];
        if (tagIds.length === 0) continue;

        const ageDays = Math.max(
            0,
            (Date.now() - new Date(row.lastWatchedAt).getTime()) / 86400000
        );
        const recencyFactor = Math.max(0.25, 1 - ageDays / 21);
        const watchWeight =
            (0.6 + Number(row.progress || 0) / 100 + (row.completed ? 0.4 : 0)) *
            recencyFactor;
        const perTag = watchWeight / tagIds.length;

        for (const tagId of tagIds) {
            bump(interestMap, tagId, perTag);
        }
    }

    for (const row of likeRows) {
        if (!row.videoId) continue;
        const tagIds = videoTagMap.get(row.videoId) || [];
        if (tagIds.length === 0) continue;

        const ageDays = Math.max(
            0,
            (Date.now() - new Date(row.createdAt).getTime()) / 86400000
        );
        const recencyFactor = Math.max(0.3, 1 - ageDays / 30);
        const perTag = (1.4 * recencyFactor) / tagIds.length;

        for (const tagId of tagIds) {
            bump(interestMap, tagId, perTag);
        }
    }

    for (const row of hiddenRows) {
        if (!row.videoId) continue;
        const tagIds = videoTagMap.get(row.videoId) || [];
        if (tagIds.length === 0) continue;

        const ageDays = Math.max(
            0,
            (Date.now() - new Date(row.createdAt).getTime()) / 86400000
        );
        const recencyFactor = Math.max(0.3, 1 - ageDays / 30);
        const perTag = (-2.2 * recencyFactor) / tagIds.length;

        for (const tagId of tagIds) {
            bump(interestMap, tagId, perTag);
        }
    }

    return interestMap;
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

export const getFeedTags = asyncHandler(async (req, res) => {
    const userId = req.user?.id || null;
    const { page = "1", limit = String(TAGS_DEFAULT_LIMIT), q = "" } = req.query;
    const searchQuery = normalizeTagName(q);
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(
        page,
        limit,
        TAGS_MAX_LIMIT
    );

    const suppression = await getSuppressionFilterForUser(userId);
    const personalizationEnabled = await isPersonalizationEnabledForUser(userId);

    const shouldUseCache = isCacheableWindow(safePage, safeLimit);
    const cacheParams = shouldUseCache
        ? {
            viewerId: userId || "anonymous",
            page: safePage,
            limit: safeLimit,
            q: searchQuery || "all",
            blockedChannels: suppression.blockedChannelIds.length,
            hiddenVideos: suppression.notInterestedVideoIds.length,
            personalized: personalizationEnabled ? "on" : "off",
        }
        : null;

    if (cacheParams) {
        const cached = await getCachedValue({
            scope: "feed:tags",
            params: cacheParams,
        });

        if (cached.hit && cached.value) {
            return res.status(200).json(
                new ApiResponse(200, cached.value.data, cached.value.message)
            );
        }
    }

    const candidateVideos = await prisma.video.findMany({
        where: buildBaseFeedVideoWhere(suppression.whereExtra),
        orderBy: [{ popularityScore: "desc" }, { createdAt: "desc" }],
        take: MAX_TAG_DISCOVERY_VIDEOS,
        select: {
            id: true,
            views: true,
            popularityScore: true,
            engagementScore: true,
            createdAt: true,
            tags: {
                select: {
                    tag: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            },
        },
    });

    const interestMap = personalizationEnabled
        ? await buildUserTagInterestMap({ userId, suppression })
        : new Map();

    const rankingMap = new Map();
    for (const video of candidateVideos) {
        const tags = (video.tags || [])
            .map((row) => row?.tag)
            .filter((tag) => tag?.id && tag?.name);

        if (tags.length === 0) continue;

        const baseScore = computeVideoTrendScore(video);
        const perTagScore = baseScore / tags.length;

        for (const tag of tags) {
            if (!rankingMap.has(tag.id)) {
                rankingMap.set(tag.id, {
                    id: tag.id,
                    name: tag.name,
                    displayName: toDisplayTagName(tag.name),
                    slug: tag.name,
                    videoCount: 0,
                    trendingScore: 0,
                    interestScore: 0,
                    lastVideoAt: null,
                });
            }

            const entry = rankingMap.get(tag.id);
            entry.videoCount += 1;
            entry.trendingScore += perTagScore;
            entry.interestScore = Number(interestMap.get(tag.id) || 0);
            if (
                !entry.lastVideoAt ||
                new Date(video.createdAt).getTime() > new Date(entry.lastVideoAt).getTime()
            ) {
                entry.lastVideoAt = video.createdAt;
            }
        }
    }

    let rankedTags = [...rankingMap.values()].map((tag) => {
        const normalizedInterest = Math.max(-5, Math.min(5, tag.interestScore));
        const finalScore = Number(
            (tag.trendingScore + normalizedInterest * 10).toFixed(4)
        );

        return {
            id: tag.id,
            name: tag.name,
            displayName: tag.displayName,
            slug: tag.slug,
            videoCount: tag.videoCount,
            lastVideoAt: tag.lastVideoAt,
            isPersonalized: normalizedInterest > 0.1,
            scores: {
                final: finalScore,
                trending: Number(tag.trendingScore.toFixed(4)),
                interest: Number(normalizedInterest.toFixed(4)),
            },
        };
    });

    if (rankedTags.length === 0) {
        const defaultTopics = getDefaultFeedTopicNames();
        const existingTags = defaultTopics.length > 0
            ? await prisma.tag.findMany({
                where: {
                    name: {
                        in: defaultTopics,
                    },
                },
                select: {
                    id: true,
                    name: true,
                },
            })
            : [];

        const tagIdByName = new Map(existingTags.map((tag) => [tag.name, tag.id]));

        rankedTags = defaultTopics.map((topic, index) => ({
            id: tagIdByName.get(topic) || `seed:${topic}`,
            name: topic,
            displayName: toDisplayTagName(topic),
            slug: topic,
            videoCount: 0,
            lastVideoAt: null,
            isPersonalized: false,
            scores: {
                final: Number((1 - index * 0.01).toFixed(4)),
                trending: 0,
                interest: 0,
            },
        }));
    }

    if (searchQuery) {
        rankedTags = rankedTags.filter((tag) =>
            tag.name.toLowerCase().includes(searchQuery)
        );
    }

    rankedTags.sort((a, b) => {
        if (b.scores.final !== a.scores.final) return b.scores.final - a.scores.final;
        if (b.videoCount !== a.videoCount) return b.videoCount - a.videoCount;
        return a.name.localeCompare(b.name);
    });

    const pagedItems = rankedTags.slice(skip, skip + safeLimit);

    const responseData = buildPaginatedListData({
        key: "tags",
        items: pagedItems,
        currentPage: safePage,
        limit: safeLimit,
        totalItems: rankedTags.length,
        extra: {
            filters: {
                q: searchQuery || null,
                personalized: personalizationEnabled,
                blockedChannels: suppression.blockedChannelIds.length,
                hiddenVideos: suppression.notInterestedVideoIds.length,
            },
        },
    });

    const responseMessage = "Feed tags fetched successfully";

    if (cacheParams) {
        await setCachedValue({
            scope: "feed:tags",
            params: cacheParams,
            value: { data: responseData, message: responseMessage },
            ttlSeconds: TAGS_CACHE_TTL_SECONDS,
        });
    }

    return res
        .status(200)
        .json(new ApiResponse(200, responseData, responseMessage));
});

export const getTagFeed = asyncHandler(async (req, res) => {
    const userId = req.user?.id || null;
    const tagName = normalizeTagName(req.params?.tagName || req.query?.tag || "");
    const {
        page = "1",
        limit = String(TAG_FEED_DEFAULT_LIMIT),
        sortBy = "score",
        sortType = "desc",
    } = req.query;

    if (!tagName) {
        throw new ApiError(400, "tagName is required");
    }

    const normalizedSortType = String(sortType || "").toLowerCase() === "asc" ? "asc" : "desc";
    const safeSortBy = String(sortBy || "").toLowerCase() === "createdat" ? "createdAt" : "score";
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(
        page,
        limit,
        TAG_FEED_MAX_LIMIT
    );

    const resolvedTag = await prisma.tag.findUnique({
        where: { name: tagName },
        select: { id: true, name: true },
    });

    if (!resolvedTag) {
        if (!getDefaultFeedTopicNames().includes(tagName)) {
            throw new ApiError(404, "Tag not found");
        }

        const responseData = buildPaginatedListData({
            items: [],
            currentPage: safePage,
            limit: safeLimit,
            totalItems: 0,
            extra: {
                tag: {
                    id: null,
                    name: tagName,
                    displayName: toDisplayTagName(tagName),
                    slug: tagName,
                },
                filters: {
                    sortBy: safeSortBy,
                    sortType: normalizedSortType,
                    personalizationBoost: 0,
                    blockedChannels: 0,
                    hiddenVideos: 0,
                },
            },
        });

        return res
            .status(200)
            .json(new ApiResponse(200, responseData, "Tag feed fetched successfully"));
    }

    const suppression = await getSuppressionFilterForUser(userId);
    const personalizationEnabled = await isPersonalizationEnabledForUser(userId);

    const shouldUseCache = isCacheableWindow(safePage, safeLimit);
    const cacheParams = shouldUseCache
        ? {
            viewerId: userId || "anonymous",
            tagId: resolvedTag.id,
            page: safePage,
            limit: safeLimit,
            sortBy: safeSortBy,
            sortType: normalizedSortType,
            blockedChannels: suppression.blockedChannelIds.length,
            hiddenVideos: suppression.notInterestedVideoIds.length,
            personalized: personalizationEnabled ? "on" : "off",
        }
        : null;

    if (cacheParams) {
        const cached = await getCachedValue({
            scope: "feed:tag",
            params: cacheParams,
        });

        if (cached.hit && cached.value) {
            return res.status(200).json(
                new ApiResponse(200, cached.value.data, cached.value.message)
            );
        }
    }

    const whereClause = buildBaseFeedVideoWhere({
        ...suppression.whereExtra,
        tags: {
            some: {
                tagId: resolvedTag.id,
            },
        },
    });

    const [videos, totalVideos] = await Promise.all([
        prisma.video.findMany({
            where: whereClause,
            orderBy:
                safeSortBy === "createdAt"
                    ? [{ createdAt: normalizedSortType }]
                    : [
                        { popularityScore: normalizedSortType },
                        { createdAt: normalizedSortType === "asc" ? "asc" : "desc" },
                    ],
            skip,
            take: safeLimit,
            select: FEED_VIDEO_SELECT,
        }),
        prisma.video.count({
            where: whereClause,
        }),
    ]);

    const enrichedVideos = flattenVideoTopicsList(
        await attachWatchProgress(videos, userId)
    );

    let personalizationBoost = 0;
    let rankedVideos = enrichedVideos;
    let usedBackfill = false;
    let backfillCount = 0;
    let totalItems = totalVideos;
    if (personalizationEnabled && safeSortBy !== "createdAt" && userId) {
        const interestMap = await buildUserTagInterestMap({ userId, suppression });
        const normalizedInterest = Math.max(-5, Math.min(5, Number(interestMap.get(resolvedTag.id) || 0)));
        personalizationBoost = Number(normalizedInterest.toFixed(4));

        rankedVideos = [...enrichedVideos]
            .map((video) => {
                let score = computeVideoTrendScore(video) + normalizedInterest * 10;

                if (video.watchProgress?.completed) {
                    score -= 8;
                } else if (Number(video.watchProgress?.progress || 0) > 0) {
                    score -= Number(video.watchProgress.progress) / 25;
                }

                return { ...video, _tagFeedScore: score };
            })
            .sort((a, b) =>
                normalizedSortType === "asc"
                    ? a._tagFeedScore - b._tagFeedScore
                    : b._tagFeedScore - a._tagFeedScore
            )
            .map((video) => {
                const normalizedVideo = { ...video };
                delete normalizedVideo._tagFeedScore;
                return normalizedVideo;
            });
    }

    if (rankedVideos.length < safeLimit) {
        const backfill = await appendRandomVideoBackfill({
            currentVideos: rankedVideos,
            take: safeLimit,
            skip,
            primaryTotal: totalVideos,
            whereClause: buildBaseFeedVideoWhere(suppression.whereExtra),
            orderBy: [{ popularityScore: "desc" }, { createdAt: "desc" }],
            seedKey: `feed:tag:${resolvedTag.id}:${userId || "anon"}:${safePage}:${safeLimit}`,
        });

        rankedVideos = backfill.videos;
        usedBackfill = backfill.usedBackfill;
        backfillCount = backfill.backfillCount;
        totalItems = Math.max(totalVideos, backfill.fallbackTotal, skip + rankedVideos.length);
    }

    const responseData = buildPaginatedListData({
        items: rankedVideos,
        currentPage: safePage,
        limit: safeLimit,
        totalItems,
        extra: {
            tag: {
                id: resolvedTag.id,
                name: resolvedTag.name,
                displayName: toDisplayTagName(resolvedTag.name),
                slug: resolvedTag.name,
            },
            filters: {
                sortBy: safeSortBy,
                sortType: normalizedSortType,
                personalizationBoost,
                blockedChannels: suppression.blockedChannelIds.length,
                hiddenVideos: suppression.notInterestedVideoIds.length,
                usedBackfill,
                backfillCount,
            },
        },
    });

    const responseMessage = "Tag feed fetched successfully";

    if (cacheParams) {
        await setCachedValue({
            scope: "feed:tag",
            params: cacheParams,
            value: { data: responseData, message: responseMessage },
            ttlSeconds: TAG_FEED_CACHE_TTL_SECONDS,
        });
    }

    return res
        .status(200)
        .json(new ApiResponse(200, responseData, responseMessage));
});

/**
 * HOME FEED
 * Mix of recent + popular videos
 */
export const getHomeFeed = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = String(HOME_FEED_DEFAULT_LIMIT),
        tag = "",
        sortBy = "createdAt",
        sortType = "desc"
    } = req.query;

    const userId = req.user?.id || null;
    const selectedTag = normalizeTagName(tag);

    // -------------------------------
    // Pagination validation
    // -------------------------------
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(
        page,
        limit,
        FEED_PAGINATION_MAX_LIMIT
    );

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
        ? { userId, page: safePage, limit: safeLimit, sortBy, sortType, tag: selectedTag || "all" }
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
    const whereClause = buildBaseFeedVideoWhere({
        ...suppression.whereExtra,
        ...(selectedTag && {
            tags: {
                some: {
                    tag: {
                        name: selectedTag,
                    },
                },
            },
        }),
    });

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
        !selectedTag && personalizedOrClauses.length > 0
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
            select: FEED_VIDEO_SELECT
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
            select: FEED_VIDEO_SELECT,
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
            select: FEED_VIDEO_SELECT,
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

    if (videos.length < safeLimit) {
        const backfill = await appendRandomVideoBackfill({
            currentVideos: videos,
            take: safeLimit,
            skip,
            primaryTotal: personalizedCount,
            whereClause,
            orderBy: fallbackOrderBy,
            seedKey: `feed:home:final:${userId || "anon"}:${safePage}:${safeLimit}:${selectedTag || "all"}`,
        });
        videos = backfill.videos;
        usedBackfill = usedBackfill || backfill.usedBackfill;
    }


    // -------------------------------
    // Attach watch progress
    // -------------------------------
    const videosWithProgress = flattenVideoTopicsList(
        await attachWatchProgress(videos, userId)
    );

    // -------------------------------
    // Total count for pagination
    // -------------------------------
    const totalVideos = await prisma.video.count({
        where: whereClause
    });
    const totalVideosForPagination = Math.max(totalVideos, skip + videosWithProgress.length);

    const responseData = buildPaginatedListData({
        items: videosWithProgress,
        currentPage: safePage,
        limit: safeLimit,
        totalItems: totalVideosForPagination,
        extra: {
            filters: {
                sortBy,
                sortType,
                tag: selectedTag || null,
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
        limit = String(SUBSCRIPTIONS_FEED_DEFAULT_LIMIT),
        isShort = "false"
    } = req.query;

    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(
        page,
        limit,
        FEED_PAGINATION_MAX_LIMIT
    );

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

    const channelIds = subscriptions.map((s) => s.channelId);
    const hasSubscriptions = channelIds.length > 0;

    const subscriptionsWhere = hasSubscriptions
        ? buildBaseFeedVideoWhere({
            ownerId: { in: channelIds },
            ...suppression.whereExtra,
            ...(isShortFilter !== undefined && { isShort: isShortFilter })
        })
        : null;

    const exploreWhere = buildBaseFeedVideoWhere({
        ...suppression.whereExtra,
        ...(isShortFilter !== undefined && { isShort: isShortFilter }),
    });

    let videos = [];
    let subscribedTotal = 0;

    if (subscriptionsWhere) {
        const [rows, count] = await Promise.all([
            prisma.video.findMany({
                where: subscriptionsWhere,
                orderBy: { createdAt: "desc" },
                skip,
                take: safeLimit,
                select: FEED_VIDEO_SELECT
            }),
            prisma.video.count({
                where: subscriptionsWhere
            }),
        ]);

        videos = rows;
        subscribedTotal = count;
    }

    let usedBackfill = false;
    let backfillCount = 0;
    let totalVideos = subscribedTotal;

    if (videos.length < safeLimit) {
        const backfill = await appendRandomVideoBackfill({
            currentVideos: videos,
            take: safeLimit,
            skip,
            primaryTotal: subscribedTotal,
            whereClause: exploreWhere,
            orderBy: [{ popularityScore: "desc" }, { createdAt: "desc" }],
            seedKey: `feed:subscriptions:${userId}:${safePage}:${safeLimit}:${isShortFilter ?? "all"}`,
        });

        videos = backfill.videos;
        usedBackfill = backfill.usedBackfill;
        backfillCount = backfill.backfillCount;
        totalVideos = Math.max(subscribedTotal, backfill.fallbackTotal, skip + videos.length);
    }

    const videosWithProgress = flattenVideoTopicsList(
        await attachWatchProgress(videos, userId)
    );

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
                subscribedChannels: channelIds.length,
                subscribedMatches: subscribedTotal,
                usedBackfill,
                backfillCount,
            }
        }
    });

    const responseMessage =
        hasSubscriptions || videosWithProgress.length > 0
            ? "Subscription feed fetched successfully"
            : "No videos available";

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
        limit = String(TRENDING_FEED_DEFAULT_LIMIT),
        isShort = "false",
        sortBy = "views",
        sortType = "desc"
    } = req.query;

    // --------------------------
    // Pagination
    // --------------------------
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(
        page,
        limit,
        FEED_PAGINATION_MAX_LIMIT
    );

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
        select: FEED_VIDEO_SELECT
    });

    // --------------------------
    // Total count
    // --------------------------
    let totalVideos = await prisma.video.count({
        where: whereClause
    });

    let usedBackfill = false;
    let backfillCount = 0;
    if (videos.length < safeLimit) {
        const backfill = await appendRandomVideoBackfill({
            currentVideos: videos,
            take: safeLimit,
            skip,
            primaryTotal: totalVideos,
            whereClause,
            orderBy: [{ popularityScore: "desc" }, { createdAt: "desc" }],
            seedKey: `feed:trending:${safePage}:${safeLimit}:${isShortFilter ?? "all"}:${sortBy}:${sortType}`,
        });

        videos = backfill.videos;
        usedBackfill = backfill.usedBackfill;
        backfillCount = backfill.backfillCount;
        totalVideos = Math.max(totalVideos, backfill.fallbackTotal, skip + videos.length);
    }

    const responseData = buildPaginatedListData({
        items: flattenVideoTopicsList(
            await attachWatchProgress(videos, userId)
        ),
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
                usedBackfill,
                backfillCount,
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
        limit = String(SHORTS_FEED_DEFAULT_LIMIT),
        sortBy = "createdAt",
        sortType = "desc",
        includeComments = "true",
        commentsLimit = "5"
    } = req.query;

    const userId = req.user?.id || null;

    // Pagination safety
    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(
        page,
        limit,
        FEED_PAGINATION_MAX_LIMIT
    );
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

    const shortsWhere = buildBaseFeedVideoWhere({
        ...suppression.whereExtra,
        isShort: true,
    });
    const shortsSelect = {
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
        tags: {
            select: {
                tag: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        },
        categories: {
            select: {
                category: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        icon: true,
                    },
                },
            },
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
                orderBy: { createdAt: "desc" },
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
            }
        })
    };

    let shorts = await prisma.video.findMany({
        where: shortsWhere,
        orderBy:
            sortBy === "createdAt"
                ? { createdAt: sortType }
                : [{ [sortBy]: sortType }, { createdAt: "desc" }],
        skip,
        take: safeLimit,
        select: shortsSelect,
    });

    let totalShorts = await prisma.video.count({
        where: shortsWhere
    });

    let usedBackfill = false;
    let backfillCount = 0;
    if (shorts.length < safeLimit) {
        const backfill = await appendRandomVideoBackfill({
            currentVideos: shorts,
            take: safeLimit,
            skip,
            primaryTotal: totalShorts,
            whereClause: shortsWhere,
            orderBy: [{ popularityScore: "desc" }, { createdAt: "desc" }],
            seedKey: `feed:shorts:${userId || "anon"}:${safePage}:${safeLimit}:${sortBy}:${sortType}`,
            select: shortsSelect,
        });

        shorts = backfill.videos;
        usedBackfill = backfill.usedBackfill;
        backfillCount = backfill.backfillCount;
        totalShorts = Math.max(totalShorts, backfill.fallbackTotal, skip + shorts.length);
    }

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
    const shortsWithProgress = flattenVideoTopicsList(
        await attachWatchProgress(formattedShorts, userId)
    );

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
                        usedBackfill,
                        backfillCount,
                    }
                }
            }),
            "Shorts feed fetched successfully"
        )
    );
});


