import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { sanitizePagination } from "../utils/pagination.js";
import { buildPaginatedListData } from "../utils/listResponse.js";
import { getCachedValue, setCachedValue } from "../utils/cache.js";

const SEARCH_CACHE_TTL_SECONDS = 20;
const DEFAULT_ALL_LIMIT_PER_TYPE = 10;
const MAX_ALL_LIMIT_PER_TYPE = 30;
const DEFAULT_TYPED_LIMIT = 20;
const MAX_TYPED_LIMIT = 100;
const RELEVANCE_CANDIDATE_MULTIPLIER = 4;
const MAX_RELEVANCE_CANDIDATES = 300;
const BACKFILL_POOL_MULTIPLIER = 6;
const MIN_BACKFILL_POOL_SIZE = 24;

const normalizeText = (value) => String(value ?? "").trim();

const parseCsv = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const parsePositiveInt = (value, fallbackValue) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallbackValue;
  return parsed;
};

const parseSortOrder = (value, fallbackValue = "desc") => {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "asc" ? "asc" : fallbackValue;
};

const resolveScope = (value) => {
  const normalized = normalizeText(value || "all").toLowerCase();
  if (["all", "videos", "shorts", "channels", "tweets", "playlists"].includes(normalized)) {
    return normalized;
  }
  return "all";
};

const normalizeSearch = (value) => normalizeText(value).toLowerCase();

const getQueryTerms = (value) =>
  normalizeSearch(value)
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8);

const scoreTextMatch = (
  value,
  query,
  { exact = 0, prefix = 0, contains = 0, tokenBonus = 0 } = {}
) => {
  const text = normalizeSearch(value);
  const normalizedQuery = normalizeSearch(query);
  if (!text || !normalizedQuery) return 0;

  let score = 0;
  if (text === normalizedQuery) {
    score += exact;
  } else if (text.startsWith(normalizedQuery)) {
    score += prefix;
  } else if (text.includes(normalizedQuery)) {
    score += contains;
  }

  if (tokenBonus > 0) {
    const terms = getQueryTerms(normalizedQuery);
    let matchedTerms = 0;
    for (const term of terms) {
      if (term.length >= 2 && text.includes(term)) {
        matchedTerms += 1;
      }
    }
    score += matchedTerms * tokenBonus;
  }

  return score;
};

const scoreRecency = (dateValue, { maxPoints = 15, halfLifeDays = 45 } = {}) => {
  if (!dateValue) return 0;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 0;

  const ageDays = Math.max(0, (Date.now() - date.getTime()) / 86400000);
  return maxPoints * Math.exp(-ageDays / halfLifeDays);
};

const scoreLogMetric = (value, { weight = 3, cap = 20 } = {}) => {
  const numeric = Number(value) || 0;
  if (numeric <= 0) return 0;
  return Math.min(cap, Math.log10(numeric + 1) * weight);
};

const isRelevanceSort = (sortBy, query) =>
  normalizeSearch(sortBy) === "relevance" && normalizeText(query).length > 0;

const resolveRelevanceCandidateTake = ({ skip = 0, take = 10 }) =>
  Math.min(
    Math.max(skip + take * RELEVANCE_CANDIDATE_MULTIPLIER, take),
    MAX_RELEVANCE_CANDIDATES
  );

const rankByRelevance = ({ items, sortType = "desc", scorer }) => {
  const order = parseSortOrder(sortType, "desc");

  return items
    .map((item, index) => ({
      item,
      index,
      score: scorer(item),
    }))
    .sort((a, b) => {
      if (order === "asc") {
        if (a.score !== b.score) return a.score - b.score;
      } else if (a.score !== b.score) {
        return b.score - a.score;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.item);
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

const normalizeNotClauses = (existingNot) => {
  if (!existingNot) return [];
  if (Array.isArray(existingNot)) return existingNot;
  return [existingNot];
};

const addNotInIds = (where, ids = []) => {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (uniqueIds.length === 0) return where;

  const baseNot = normalizeNotClauses(where?.NOT);
  return {
    ...where,
    NOT: [...baseNot, { id: { in: uniqueIds } }],
  };
};

const resolveBackfillPoolTake = (needed) =>
  Math.min(
    Math.max((Number(needed) || 0) * BACKFILL_POOL_MULTIPLIER, MIN_BACKFILL_POOL_SIZE),
    MAX_RELEVANCE_CANDIDATES
  );

const resolveBackfillSkip = ({ skip = 0, primaryTotal = 0, fallbackTotal = 0 }) => {
  const adjusted = Math.max(0, Number(skip || 0) - Math.max(0, Number(primaryTotal || 0)));
  const total = Math.max(0, Number(fallbackTotal || 0));
  if (total <= 0) return 0;
  return adjusted >= total ? adjusted % total : adjusted;
};

const fillWithRandomBackfill = ({ primaryItems, fallbackItems, take, seedInput }) => {
  const output = Array.isArray(primaryItems) ? [...primaryItems] : [];
  if (output.length >= take) return output.slice(0, take);

  const existingIds = new Set(output.map((item) => item?.id).filter(Boolean));
  const filteredFallback = (Array.isArray(fallbackItems) ? fallbackItems : []).filter((item) => {
    const id = item?.id;
    if (!id || existingIds.has(id)) return false;
    existingIds.add(id);
    return true;
  });

  if (filteredFallback.length === 0) return output.slice(0, take);

  const dayKey = new Date().toISOString().slice(0, 10);
  const shuffled = seededShuffle(filteredFallback, `${seedInput}:${dayKey}`);
  const remaining = Math.max(0, take - output.length);

  return [...output, ...shuffled.slice(0, remaining)];
};

const buildPublicOwnerFilter = () => ({
  isDeleted: false,
  moderationStatus: "ACTIVE",
  AND: [
    {
      OR: [
        { settings: { is: null } },
        {
          settings: {
            is: {
              profileVisibility: "PUBLIC",
            },
          },
        },
      ],
    },
  ],
});

const toVideoItem = (video) => ({
  id: video.id,
  title: video.title,
  thumbnail: video.thumbnail,
  duration: video.duration,
  views: video.views,
  isShort: video.isShort,
  createdAt: video.createdAt,
  owner: video.owner || null,
  tags: Array.isArray(video.tags)
    ? video.tags.map((row) => row?.tag?.name).filter(Boolean)
    : [],
});

const toChannelItem = (channel) => ({
  id: channel.id,
  username: channel.username,
  fullName: channel.fullName,
  avatar: channel.avatar,
  coverImage: channel.coverImage,
  channelDescription: channel.channelDescription || "",
  subscribersCount: channel._count?.subscribers || 0,
  createdAt: channel.createdAt,
  categories: Array.isArray(channel.channelCategories)
    ? channel.channelCategories
        .map((row) => ({
          id: row?.category?.id,
          name: row?.category?.name,
          slug: row?.category?.slug,
        }))
        .filter((entry) => entry.id)
    : [],
});

const toTweetItem = (tweet) => ({
  id: tweet.id,
  content: tweet.content,
  image: tweet.image,
  createdAt: tweet.createdAt,
  owner: tweet.owner || null,
  likesCount: tweet._count?.likes || 0,
  commentsCount: tweet._count?.comments || 0,
});

const toPlaylistItem = (playlist) => ({
  id: playlist.id,
  name: playlist.name,
  description: playlist.description,
  videoCount: playlist.videoCount,
  totalDuration: playlist.totalDuration,
  updatedAt: playlist.updatedAt,
  createdAt: playlist.createdAt,
  owner: playlist.owner || null,
});

const buildVideoWhere = ({ q, tags, category, videoType = "all" }) => {
  const where = {
    isPublished: true,
    isDeleted: false,
    processingStatus: "COMPLETED",
    isHlsReady: true,
    owner: {
      is: buildPublicOwnerFilter(),
    },
  };

  if (videoType === "videos") {
    where.isShort = false;
  } else if (videoType === "shorts") {
    where.isShort = true;
  }

  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { owner: { is: { username: { contains: q, mode: "insensitive" } } } },
      { owner: { is: { fullName: { contains: q, mode: "insensitive" } } } },
      {
        tags: {
          some: {
            tag: { name: { contains: q, mode: "insensitive" } },
          },
        },
      },
    ];
  }

  if (tags.length > 0) {
    where.tags = {
      some: {
        OR: tags.map((tagName) => ({
          tag: {
            name: { equals: tagName, mode: "insensitive" },
          },
        })),
      },
    };
  }

  if (tags.length > 0 && q) {
    where.tags = {
      some: {
        OR: [
          ...tags.map((tagName) => ({
            tag: {
              name: { equals: tagName, mode: "insensitive" },
            },
          })),
          {
            tag: {
              name: { contains: q, mode: "insensitive" },
            },
          },
        ],
      },
    };
  }

  if (category) {
    where.categories = {
      some: {
        category: {
          OR: [
            { slug: { equals: category, mode: "insensitive" } },
            { name: { equals: category, mode: "insensitive" } },
          ],
        },
      },
    };
  }

  return where;
};

const buildChannelSearchOrClauses = (q) => {
  const query = normalizeText(q);
  if (!query) return [];

  const variants = new Set();
  variants.add(query);

  const withoutAt = query.replace(/^@+/, "").trim();
  if (withoutAt) variants.add(withoutAt);

  const compact = withoutAt.replace(/\s+/g, "");
  if (compact) variants.add(compact);

  const clauses = [];
  for (const variant of variants) {
    clauses.push(
      { username: { contains: variant, mode: "insensitive" } },
      { fullName: { contains: variant, mode: "insensitive" } }
    );
  }

  clauses.push({ channelDescription: { contains: query, mode: "insensitive" } });

  return clauses;
};

const buildChannelTokenAndClauses = (q) => {
  const terms = getQueryTerms(q).filter((term) => term.length >= 2);
  if (terms.length <= 1) return [];

  return terms.map((term) => ({
    OR: [
      { username: { contains: term, mode: "insensitive" } },
      { fullName: { contains: term, mode: "insensitive" } },
    ],
  }));
};

const buildChannelWhere = ({ q, category }) => {
  const where = {
    ...buildPublicOwnerFilter(),
    OR: [],
  };

  if (q) {
    where.OR.push(...buildChannelSearchOrClauses(q));

    const tokenAndClauses = buildChannelTokenAndClauses(q);
    if (tokenAndClauses.length > 0) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...tokenAndClauses];
    }
  }

  if (category) {
    where.channelCategories = {
      some: {
        category: {
          OR: [
            { slug: { equals: category, mode: "insensitive" } },
            { name: { equals: category, mode: "insensitive" } },
          ],
        },
      },
    };
  }

  if (where.OR.length === 0) {
    delete where.OR;
  }

  return where;
};

const buildTweetWhere = ({ q }) => {
  const where = {
    isDeleted: false,
    owner: {
      is: buildPublicOwnerFilter(),
    },
  };

  if (q) {
    where.OR = [
      { content: { contains: q, mode: "insensitive" } },
      { owner: { is: { username: { contains: q, mode: "insensitive" } } } },
      { owner: { is: { fullName: { contains: q, mode: "insensitive" } } } },
    ];
  }

  return where;
};

const buildPlaylistWhere = ({ q }) => {
  const where = {
    isPublic: true,
    isDeleted: false,
    owner: {
      is: buildPublicOwnerFilter(),
    },
  };

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { owner: { is: { username: { contains: q, mode: "insensitive" } } } },
      { owner: { is: { fullName: { contains: q, mode: "insensitive" } } } },
    ];
  }

  return where;
};

const resolveVideoOrderBy = (sortBy, sortType) => {
  const order = parseSortOrder(sortType, "desc");
  const key = normalizeText(sortBy).toLowerCase();
  if (key === "relevance") return [{ views: "desc" }, { createdAt: "desc" }];
  if (key === "views") return { views: order };
  if (key === "duration") return { duration: order };
  if (key === "title") return { title: order };
  if (key === "date" || key === "createdat" || key === "newest") return { createdAt: order };
  return { createdAt: order };
};

const resolveChannelOrderBy = (sortBy, sortType) => {
  const order = parseSortOrder(sortType, "desc");
  const key = normalizeText(sortBy).toLowerCase();
  if (key === "relevance") return [{ subscribers: { _count: "desc" } }, { createdAt: "desc" }];
  if (key === "name" || key === "fullname") return { fullName: order };
  if (key === "username") return { username: order };
  if (key === "subscribers") return { subscribers: { _count: order } };
  return { createdAt: order };
};

const resolveTweetOrderBy = (sortBy, sortType) => {
  const order = parseSortOrder(sortType, "desc");
  const key = normalizeText(sortBy).toLowerCase();
  if (key === "relevance") return [{ likes: { _count: "desc" } }, { createdAt: "desc" }];
  if (key === "likes") return { likes: { _count: order } };
  if (key === "comments") return { comments: { _count: order } };
  return { createdAt: order };
};

const resolvePlaylistOrderBy = (sortBy, sortType) => {
  const order = parseSortOrder(sortType, "desc");
  const key = normalizeText(sortBy).toLowerCase();
  if (key === "relevance") return [{ videoCount: "desc" }, { updatedAt: "desc" }];
  if (key === "name") return { name: order };
  if (key === "videocount") return { videoCount: order };
  if (key === "duration") return { totalDuration: order };
  if (key === "createdat") return { createdAt: order };
  return { updatedAt: order };
};

const scoreVideoRelevance = (video, query) => {
  let score = 0;

  score += scoreTextMatch(video.title, query, {
    exact: 120,
    prefix: 72,
    contains: 45,
    tokenBonus: 6,
  });
  score += scoreTextMatch(video.description, query, {
    exact: 25,
    prefix: 20,
    contains: 15,
    tokenBonus: 3,
  });
  score += scoreTextMatch(video.owner?.username, query, {
    exact: 55,
    prefix: 34,
    contains: 20,
    tokenBonus: 4,
  });
  score += scoreTextMatch(video.owner?.fullName, query, {
    exact: 60,
    prefix: 38,
    contains: 22,
    tokenBonus: 4,
  });

  const tagNames = Array.isArray(video.tags)
    ? video.tags.map((row) => row?.tag?.name).filter(Boolean)
    : [];
  for (const name of tagNames) {
    score += scoreTextMatch(name, query, {
      exact: 28,
      prefix: 20,
      contains: 14,
      tokenBonus: 2,
    });
  }

  score += scoreLogMetric(video.views, { weight: 4.4, cap: 24 });
  score += scoreRecency(video.createdAt, { maxPoints: 18, halfLifeDays: 60 });

  return score;
};

const scoreChannelRelevance = (channel, query) => {
  let score = 0;

  score += scoreTextMatch(channel.username, query, {
    exact: 120,
    prefix: 78,
    contains: 44,
    tokenBonus: 7,
  });
  score += scoreTextMatch(channel.fullName, query, {
    exact: 125,
    prefix: 82,
    contains: 46,
    tokenBonus: 7,
  });
  score += scoreTextMatch(channel.channelDescription, query, {
    exact: 35,
    prefix: 28,
    contains: 20,
    tokenBonus: 4,
  });

  const categoryNames = Array.isArray(channel.channelCategories)
    ? channel.channelCategories
        .map((row) => row?.category?.name || row?.category?.slug)
        .filter(Boolean)
    : [];
  for (const name of categoryNames) {
    score += scoreTextMatch(name, query, {
      exact: 24,
      prefix: 18,
      contains: 12,
      tokenBonus: 2,
    });
  }

  score += scoreLogMetric(channel?._count?.subscribers || 0, {
    weight: 4.2,
    cap: 24,
  });
  score += scoreRecency(channel.createdAt, { maxPoints: 8, halfLifeDays: 90 });

  return score;
};

const scoreTweetRelevance = (tweet, query) => {
  let score = 0;

  score += scoreTextMatch(tweet.content, query, {
    exact: 90,
    prefix: 58,
    contains: 36,
    tokenBonus: 5,
  });
  score += scoreTextMatch(tweet.owner?.username, query, {
    exact: 40,
    prefix: 26,
    contains: 16,
    tokenBonus: 3,
  });
  score += scoreTextMatch(tweet.owner?.fullName, query, {
    exact: 45,
    prefix: 30,
    contains: 18,
    tokenBonus: 3,
  });

  score += scoreLogMetric(tweet?._count?.likes || 0, { weight: 3.4, cap: 16 });
  score += scoreLogMetric(tweet?._count?.comments || 0, { weight: 3.0, cap: 14 });
  score += scoreRecency(tweet.createdAt, { maxPoints: 18, halfLifeDays: 21 });

  return score;
};

const scorePlaylistRelevance = (playlist, query) => {
  let score = 0;

  score += scoreTextMatch(playlist.name, query, {
    exact: 120,
    prefix: 76,
    contains: 42,
    tokenBonus: 6,
  });
  score += scoreTextMatch(playlist.description, query, {
    exact: 30,
    prefix: 24,
    contains: 16,
    tokenBonus: 3,
  });
  score += scoreTextMatch(playlist.owner?.username, query, {
    exact: 36,
    prefix: 24,
    contains: 14,
    tokenBonus: 2,
  });
  score += scoreTextMatch(playlist.owner?.fullName, query, {
    exact: 40,
    prefix: 26,
    contains: 15,
    tokenBonus: 2,
  });

  score += scoreLogMetric(playlist.videoCount, { weight: 3.6, cap: 16 });
  score += scoreRecency(playlist.updatedAt || playlist.createdAt, {
    maxPoints: 12,
    halfLifeDays: 45,
  });

  return score;
};

const findVideos = async ({
  q,
  tags,
  category,
  skip = 0,
  take = 10,
  sortBy,
  sortType,
  videoType = "all",
}) => {
  const where = buildVideoWhere({ q, tags, category, videoType });
  const fallbackBaseWhere = normalizeText(q)
    ? buildVideoWhere({ q: "", tags, category, videoType })
    : null;
  const orderBy = resolveVideoOrderBy(sortBy, sortType);
  const useRelevance = isRelevanceSort(sortBy, q) && skip < MAX_RELEVANCE_CANDIDATES;

  const select = {
    id: true,
    title: true,
    description: true,
    thumbnail: true,
    duration: true,
    views: true,
    isShort: true,
    createdAt: true,
    owner: {
      select: {
        id: true,
        username: true,
        fullName: true,
        avatar: true,
      },
    },
    tags: {
      select: {
        tag: {
          select: {
            name: true,
          },
        },
      },
    },
  };

  let items = [];
  let totalItems = 0;

  if (useRelevance) {
    const relevanceTake = resolveRelevanceCandidateTake({ skip, take });
    const [candidates, total] = await Promise.all([
      prisma.video.findMany({
        where,
        orderBy,
        take: relevanceTake,
        select,
      }),
      prisma.video.count({ where }),
    ]);

    const ranked = rankByRelevance({
      items: candidates,
      sortType,
      scorer: (item) => scoreVideoRelevance(item, q),
    });
    const pageItems = ranked.slice(skip, skip + take);
    items = pageItems.map(toVideoItem);
    totalItems = total;
  } else {
    const [rows, total] = await Promise.all([
      prisma.video.findMany({
        where,
        orderBy,
        skip,
        take,
        select,
      }),
      prisma.video.count({ where }),
    ]);

    items = rows.map(toVideoItem);
    totalItems = total;
  }

  if (fallbackBaseWhere && items.length < take) {
    const remaining = take - items.length;
    const fallbackTotal = await prisma.video.count({ where: fallbackBaseWhere });
    const fallbackRows = await prisma.video.findMany({
      where: addNotInIds(fallbackBaseWhere, items.map((item) => item.id)),
      orderBy: [{ createdAt: "desc" }],
      skip: resolveBackfillSkip({
        skip,
        primaryTotal: totalItems,
        fallbackTotal,
      }),
      take: resolveBackfillPoolTake(remaining),
      select,
    });

    items = fillWithRandomBackfill({
      primaryItems: items,
      fallbackItems: fallbackRows.map(toVideoItem),
      take,
      seedInput: `search:videos:${videoType}:${normalizeSearch(q)}:${skip}:${take}`,
    });
    totalItems = Math.max(totalItems, fallbackTotal, skip + items.length);
  }

  return { items, totalItems };
};

const findChannels = async ({ q, category, skip = 0, take = 10, sortBy, sortType }) => {
  const where = buildChannelWhere({ q, category });
  const fallbackBaseWhere = normalizeText(q)
    ? buildChannelWhere({ q: "", category })
    : null;
  const orderBy = resolveChannelOrderBy(sortBy, sortType);
  const useRelevance = isRelevanceSort(sortBy, q) && skip < MAX_RELEVANCE_CANDIDATES;

  const select = {
    id: true,
    username: true,
    fullName: true,
    avatar: true,
    coverImage: true,
    channelDescription: true,
    createdAt: true,
    _count: {
      select: {
        subscribers: true,
      },
    },
    channelCategories: {
      select: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    },
  };

  let items = [];
  let totalItems = 0;

  if (useRelevance) {
    const relevanceTake = resolveRelevanceCandidateTake({ skip, take });
    const [candidates, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy,
        take: relevanceTake,
        select,
      }),
      prisma.user.count({ where }),
    ]);

    const ranked = rankByRelevance({
      items: candidates,
      sortType,
      scorer: (item) => scoreChannelRelevance(item, q),
    });
    const pageItems = ranked.slice(skip, skip + take);
    items = pageItems.map(toChannelItem);
    totalItems = total;
  } else {
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy,
        skip,
        take,
        select,
      }),
      prisma.user.count({ where }),
    ]);

    items = rows.map(toChannelItem);
    totalItems = total;
  }

  if (fallbackBaseWhere && items.length < take) {
    const remaining = take - items.length;
    const fallbackTotal = await prisma.user.count({ where: fallbackBaseWhere });
    const fallbackRows = await prisma.user.findMany({
      where: addNotInIds(fallbackBaseWhere, items.map((item) => item.id)),
      orderBy: [{ createdAt: "desc" }],
      skip: resolveBackfillSkip({
        skip,
        primaryTotal: totalItems,
        fallbackTotal,
      }),
      take: resolveBackfillPoolTake(remaining),
      select,
    });

    items = fillWithRandomBackfill({
      primaryItems: items,
      fallbackItems: fallbackRows.map(toChannelItem),
      take,
      seedInput: `search:channels:${normalizeSearch(q)}:${skip}:${take}`,
    });
    totalItems = Math.max(totalItems, fallbackTotal, skip + items.length);
  }

  return { items, totalItems };
};

const findTweets = async ({ q, skip = 0, take = 10, sortBy, sortType }) => {
  const where = buildTweetWhere({ q });
  const fallbackBaseWhere = normalizeText(q) ? buildTweetWhere({ q: "" }) : null;
  const orderBy = resolveTweetOrderBy(sortBy, sortType);
  const useRelevance = isRelevanceSort(sortBy, q) && skip < MAX_RELEVANCE_CANDIDATES;

  const select = {
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
  };

  let items = [];
  let totalItems = 0;

  if (useRelevance) {
    const relevanceTake = resolveRelevanceCandidateTake({ skip, take });
    const [candidates, total] = await Promise.all([
      prisma.tweet.findMany({
        where,
        orderBy,
        take: relevanceTake,
        select,
      }),
      prisma.tweet.count({ where }),
    ]);

    const ranked = rankByRelevance({
      items: candidates,
      sortType,
      scorer: (item) => scoreTweetRelevance(item, q),
    });
    const pageItems = ranked.slice(skip, skip + take);
    items = pageItems.map(toTweetItem);
    totalItems = total;
  } else {
    const [rows, total] = await Promise.all([
      prisma.tweet.findMany({
        where,
        orderBy,
        skip,
        take,
        select,
      }),
      prisma.tweet.count({ where }),
    ]);

    items = rows.map(toTweetItem);
    totalItems = total;
  }

  if (fallbackBaseWhere && items.length < take) {
    const remaining = take - items.length;
    const fallbackTotal = await prisma.tweet.count({ where: fallbackBaseWhere });
    const fallbackRows = await prisma.tweet.findMany({
      where: addNotInIds(fallbackBaseWhere, items.map((item) => item.id)),
      orderBy: [{ createdAt: "desc" }],
      skip: resolveBackfillSkip({
        skip,
        primaryTotal: totalItems,
        fallbackTotal,
      }),
      take: resolveBackfillPoolTake(remaining),
      select,
    });

    items = fillWithRandomBackfill({
      primaryItems: items,
      fallbackItems: fallbackRows.map(toTweetItem),
      take,
      seedInput: `search:tweets:${normalizeSearch(q)}:${skip}:${take}`,
    });
    totalItems = Math.max(totalItems, fallbackTotal, skip + items.length);
  }

  return { items, totalItems };
};

const findPlaylists = async ({ q, skip = 0, take = 10, sortBy, sortType }) => {
  const where = buildPlaylistWhere({ q });
  const fallbackBaseWhere = normalizeText(q) ? buildPlaylistWhere({ q: "" }) : null;
  const orderBy = resolvePlaylistOrderBy(sortBy, sortType);
  const useRelevance = isRelevanceSort(sortBy, q) && skip < MAX_RELEVANCE_CANDIDATES;

  const select = {
    id: true,
    name: true,
    description: true,
    videoCount: true,
    totalDuration: true,
    updatedAt: true,
    createdAt: true,
    owner: {
      select: {
        id: true,
        username: true,
        fullName: true,
        avatar: true,
      },
    },
  };

  let items = [];
  let totalItems = 0;

  if (useRelevance) {
    const relevanceTake = resolveRelevanceCandidateTake({ skip, take });
    const [candidates, total] = await Promise.all([
      prisma.playlist.findMany({
        where,
        orderBy,
        take: relevanceTake,
        select,
      }),
      prisma.playlist.count({ where }),
    ]);

    const ranked = rankByRelevance({
      items: candidates,
      sortType,
      scorer: (item) => scorePlaylistRelevance(item, q),
    });
    const pageItems = ranked.slice(skip, skip + take);
    items = pageItems.map(toPlaylistItem);
    totalItems = total;
  } else {
    const [rows, total] = await Promise.all([
      prisma.playlist.findMany({
        where,
        orderBy,
        skip,
        take,
        select,
      }),
      prisma.playlist.count({ where }),
    ]);

    items = rows.map(toPlaylistItem);
    totalItems = total;
  }

  if (fallbackBaseWhere && items.length < take) {
    const remaining = take - items.length;
    const fallbackTotal = await prisma.playlist.count({ where: fallbackBaseWhere });
    const fallbackRows = await prisma.playlist.findMany({
      where: addNotInIds(fallbackBaseWhere, items.map((item) => item.id)),
      orderBy: [{ updatedAt: "desc" }],
      skip: resolveBackfillSkip({
        skip,
        primaryTotal: totalItems,
        fallbackTotal,
      }),
      take: resolveBackfillPoolTake(remaining),
      select,
    });

    items = fillWithRandomBackfill({
      primaryItems: items,
      fallbackItems: fallbackRows.map(toPlaylistItem),
      take,
      seedInput: `search:playlists:${normalizeSearch(q)}:${skip}:${take}`,
    });
    totalItems = Math.max(totalItems, fallbackTotal, skip + items.length);
  }

  return { items, totalItems };
};

const saveSearchHistory = async ({ userId, query }) => {
  const normalizedQuery = normalizeText(query);
  if (!userId || normalizedQuery.length < 2) return;

  await prisma.searchHistory
    .create({
      data: {
        userId,
        query: normalizedQuery.slice(0, 250),
      },
    })
    .catch(() => null);
};

export const searchPublic = asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;
  const q = normalizeText(req.query?.q || req.query?.query || req.query?.search || "");
  const tags = parseCsv(req.query?.tags).map((entry) => entry.toLowerCase());
  const category = normalizeText(req.query?.category || req.query?.channelCategory || "");
  const scope = resolveScope(req.query?.scope || req.query?.type);
  const sortBy = normalizeText(req.query?.sortBy || "");
  const sortType = normalizeText(req.query?.sortType || "desc");

  if (q.length > 120) {
    throw new ApiError(400, "q must be at most 120 characters");
  }

  if (scope === "all") {
    const perTypeLimit = Math.min(
      parsePositiveInt(req.query?.perTypeLimit, DEFAULT_ALL_LIMIT_PER_TYPE),
      MAX_ALL_LIMIT_PER_TYPE
    );

    const cacheParams = {
      scope,
      q,
      tags,
      category,
      perTypeLimit,
      sortBy,
      sortType,
    };

    const cached = await getCachedValue({
      scope: "search:public:all",
      params: cacheParams,
    });

    if (cached.hit && cached.value) {
      await saveSearchHistory({ userId, query: q });
      return res.status(200).json(new ApiResponse(200, cached.value, "Search results fetched"));
    }

    const [videos, shorts, channels, tweets, playlists] = await Promise.all([
      findVideos({
        q,
        tags,
        category,
        take: perTypeLimit,
        sortBy,
        sortType,
        videoType: "videos",
      }),
      findVideos({
        q,
        tags,
        category,
        take: perTypeLimit,
        sortBy,
        sortType,
        videoType: "shorts",
      }),
      findChannels({
        q,
        category,
        take: perTypeLimit,
        sortBy,
        sortType,
      }),
      findTweets({
        q,
        take: perTypeLimit,
        sortBy,
        sortType,
      }),
      findPlaylists({
        q,
        take: perTypeLimit,
        sortBy,
        sortType,
      }),
    ]);

    const payload = {
      scope: "all",
      query: q,
      filters: {
        tags,
        category: category || null,
      },
      limits: {
        perTypeLimit,
      },
      results: {
        videos: videos.items,
        shorts: shorts.items,
        channels: channels.items,
        tweets: tweets.items,
        playlists: playlists.items,
      },
      totals: {
        videos: videos.totalItems,
        shorts: shorts.totalItems,
        channels: channels.totalItems,
        tweets: tweets.totalItems,
        playlists: playlists.totalItems,
      },
    };

    await setCachedValue({
      scope: "search:public:all",
      params: cacheParams,
      value: payload,
      ttlSeconds: SEARCH_CACHE_TTL_SECONDS,
    });

    await saveSearchHistory({ userId, query: q });

    return res.status(200).json(new ApiResponse(200, payload, "Search results fetched"));
  }

  const { page, limit, skip } = sanitizePagination(
    req.query?.page,
    req.query?.limit,
    MAX_TYPED_LIMIT
  );
  const typedLimit = limit || DEFAULT_TYPED_LIMIT;

  const cacheParams = {
    scope,
    q,
    tags,
    category,
    page,
    limit: typedLimit,
    sortBy,
    sortType,
  };

  const cached = await getCachedValue({
    scope: `search:public:${scope}`,
    params: cacheParams,
  });

  if (cached.hit && cached.value) {
    await saveSearchHistory({ userId, query: q });
    return res.status(200).json(new ApiResponse(200, cached.value, "Search results fetched"));
  }

  let finderResult = null;
  let key = "items";

  if (scope === "videos") {
    finderResult = await findVideos({
      q,
      tags,
      category,
      skip,
      take: typedLimit,
      sortBy,
      sortType,
      videoType: "videos",
    });
    key = "videos";
  } else if (scope === "shorts") {
    finderResult = await findVideos({
      q,
      tags,
      category,
      skip,
      take: typedLimit,
      sortBy,
      sortType,
      videoType: "shorts",
    });
    key = "shorts";
  } else if (scope === "channels") {
    finderResult = await findChannels({
      q,
      category,
      skip,
      take: typedLimit,
      sortBy,
      sortType,
    });
    key = "channels";
  } else if (scope === "tweets") {
    finderResult = await findTweets({
      q,
      skip,
      take: typedLimit,
      sortBy,
      sortType,
    });
    key = "tweets";
  } else if (scope === "playlists") {
    finderResult = await findPlaylists({
      q,
      skip,
      take: typedLimit,
      sortBy,
      sortType,
    });
    key = "playlists";
  } else {
    throw new ApiError(400, "Invalid scope");
  }

  const payload = buildPaginatedListData({
    key,
    items: finderResult.items,
    currentPage: page,
    limit: typedLimit,
    totalItems: finderResult.totalItems,
    extra: {
      scope,
      query: q,
      filters: {
        tags,
        category: category || null,
      },
    },
  });

  await setCachedValue({
    scope: `search:public:${scope}`,
    params: cacheParams,
    value: payload,
    ttlSeconds: SEARCH_CACHE_TTL_SECONDS,
  });

  await saveSearchHistory({ userId, query: q });

  return res.status(200).json(new ApiResponse(200, payload, "Search results fetched"));
});
