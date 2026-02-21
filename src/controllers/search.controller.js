import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { sanitizePagination } from "../utils/pagination.js";
import { buildPaginatedListData } from "../utils/listResponse.js";
import { getCachedValue, setCachedValue } from "../utils/cache.js";

const SEARCH_CACHE_TTL_SECONDS = 20;
const DEFAULT_ALL_LIMIT_PER_TYPE = 5;
const MAX_ALL_LIMIT_PER_TYPE = 15;
const DEFAULT_TYPED_LIMIT = 10;
const MAX_TYPED_LIMIT = 50;

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
  if (["all", "videos", "channels", "tweets", "playlists"].includes(normalized)) {
    return normalized;
  }
  return "all";
};

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

const buildVideoWhere = ({ q, tags, category }) => {
  const where = {
    isPublished: true,
    isDeleted: false,
    processingStatus: "COMPLETED",
    isHlsReady: true,
    owner: {
      is: {
        isDeleted: false,
      },
    },
  };

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

const buildChannelWhere = ({ q, category }) => {
  const where = {
    isDeleted: false,
    OR: [],
  };

  if (q) {
    where.OR.push(
      { username: { contains: q, mode: "insensitive" } },
      { fullName: { contains: q, mode: "insensitive" } },
      { channelDescription: { contains: q, mode: "insensitive" } }
    );
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
    owner: { is: { isDeleted: false } },
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
    owner: { is: { isDeleted: false } },
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
  if (key === "views") return { views: order };
  if (key === "duration") return { duration: order };
  if (key === "title") return { title: order };
  return { createdAt: order };
};

const resolveChannelOrderBy = (sortBy, sortType) => {
  const order = parseSortOrder(sortType, "desc");
  const key = normalizeText(sortBy).toLowerCase();
  if (key === "name" || key === "fullname") return { fullName: order };
  if (key === "username") return { username: order };
  if (key === "subscribers") return { subscribers: { _count: order } };
  return { createdAt: order };
};

const resolveTweetOrderBy = (sortBy, sortType) => {
  const order = parseSortOrder(sortType, "desc");
  const key = normalizeText(sortBy).toLowerCase();
  if (key === "likes") return { likes: { _count: order } };
  if (key === "comments") return { comments: { _count: order } };
  return { createdAt: order };
};

const resolvePlaylistOrderBy = (sortBy, sortType) => {
  const order = parseSortOrder(sortType, "desc");
  const key = normalizeText(sortBy).toLowerCase();
  if (key === "name") return { name: order };
  if (key === "videocount") return { videoCount: order };
  if (key === "duration") return { totalDuration: order };
  if (key === "createdat") return { createdAt: order };
  return { updatedAt: order };
};

const findVideos = async ({ q, tags, category, skip = 0, take = 10, sortBy, sortType }) => {
  const where = buildVideoWhere({ q, tags, category });
  const orderBy = resolveVideoOrderBy(sortBy, sortType);

  const [items, totalItems] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
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
      },
    }),
    prisma.video.count({ where }),
  ]);

  return {
    items: items.map(toVideoItem),
    totalItems,
  };
};

const findChannels = async ({ q, category, skip = 0, take = 10, sortBy, sortType }) => {
  const where = buildChannelWhere({ q, category });
  const orderBy = resolveChannelOrderBy(sortBy, sortType);

  const [items, totalItems] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
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
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: items.map(toChannelItem),
    totalItems,
  };
};

const findTweets = async ({ q, skip = 0, take = 10, sortBy, sortType }) => {
  const where = buildTweetWhere({ q });
  const orderBy = resolveTweetOrderBy(sortBy, sortType);

  const [items, totalItems] = await Promise.all([
    prisma.tweet.findMany({
      where,
      orderBy,
      skip,
      take,
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
    }),
    prisma.tweet.count({ where }),
  ]);

  return {
    items: items.map(toTweetItem),
    totalItems,
  };
};

const findPlaylists = async ({ q, skip = 0, take = 10, sortBy, sortType }) => {
  const where = buildPlaylistWhere({ q });
  const orderBy = resolvePlaylistOrderBy(sortBy, sortType);

  const [items, totalItems] = await Promise.all([
    prisma.playlist.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
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
      },
    }),
    prisma.playlist.count({ where }),
  ]);

  return {
    items: items.map(toPlaylistItem),
    totalItems,
  };
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
  const q = normalizeText(req.query?.q || "");
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

    const [videos, channels, tweets, playlists] = await Promise.all([
      findVideos({
        q,
        tags,
        category,
        take: perTypeLimit,
        sortBy,
        sortType,
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
        channels: channels.items,
        tweets: tweets.items,
        playlists: playlists.items,
      },
      totals: {
        videos: videos.totalItems,
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
    });
    key = "videos";
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
