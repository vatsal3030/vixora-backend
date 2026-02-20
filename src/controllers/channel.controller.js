import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { getCachedValue, setCachedValue } from "../utils/cache.js";
import { buildPaginatedListData } from "../utils/listResponse.js";

const CHANNEL_INFO_CACHE_TTL_SECONDS = 30;

const CHANNEL_VIDEO_BASE_DEFAULT_LIMIT = 20;
const CHANNEL_SHORTS_DEFAULT_LIMIT = 30;
const CHANNEL_PLAYLIST_DEFAULT_LIMIT = 50;
const CHANNEL_TWEET_DEFAULT_LIMIT = 20;

const CHANNEL_VIDEO_MAX_LIMIT = 50;
const CHANNEL_SHORTS_MAX_LIMIT = 60;
const CHANNEL_PLAYLIST_MAX_LIMIT = 100;
const CHANNEL_TWEET_MAX_LIMIT = 50;

const toSafePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
};

const resolvePagination = (query, { defaultLimit, maxLimit }) => {
  const page = toSafePositiveInt(query?.page, 1);
  const requestedLimit = toSafePositiveInt(query?.limit, defaultLimit);
  const limit = Math.min(requestedLimit, maxLimit);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const resolveVideoOrderBy = (sort) => {
  if (sort === "popular") return { views: "desc" };
  if (sort === "oldest") return { createdAt: "asc" };
  return { createdAt: "desc" };
};

const buildPublicVideoWhere = ({ channelId, isShort }) => ({
  ownerId: channelId,
  isPublished: true,
  isDeleted: false,
  processingStatus: "COMPLETED",
  isHlsReady: true,
  ...(typeof isShort === "boolean" ? { isShort } : {}),
});

const ensureActiveChannelExists = async (channelId) => {
  const channel = await prisma.user.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      isDeleted: true,
    },
  });

  if (!channel || channel.isDeleted) {
    throw new ApiError(404, "Channel not found");
  }
};

const getActiveChannelProfile = async (channelId) => {
  const channel = await prisma.user.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      username: true,
      fullName: true,
      avatar: true,
      coverImage: true,
      channelDescription: true,
      channelLinks: true,
      isDeleted: true,
      createdAt: true,
      _count: {
        select: {
          subscribers: true,
        },
      },
    },
  });

  if (!channel || channel.isDeleted) {
    throw new ApiError(404, "Channel not found");
  }

  return channel;
};

const getIsSubscribed = async ({ userId, channelId }) => {
  if (!userId) return false;

  const subscription = await prisma.subscription.findUnique({
    where: {
      subscriberId_channelId: {
        subscriberId: userId,
        channelId,
      },
    },
  });

  return !!subscription;
};

const getChannelPublicStats = async (channelId) => {
  const publicAllVideoWhere = buildPublicVideoWhere({ channelId });
  const publicLongVideoWhere = buildPublicVideoWhere({
    channelId,
    isShort: false,
  });
  const publicShortVideoWhere = buildPublicVideoWhere({
    channelId,
    isShort: true,
  });

  const [
    videoAggregate,
    longVideosCount,
    shortsCount,
    playlistsCount,
    tweetsCount,
    videoLikesCount,
    tweetLikesCount,
    videoCommentsCount,
    tweetCommentsCount,
  ] = await prisma.$transaction([
    prisma.video.aggregate({
      where: publicAllVideoWhere,
      _sum: { views: true },
    }),
    prisma.video.count({ where: publicLongVideoWhere }),
    prisma.video.count({ where: publicShortVideoWhere }),
    prisma.playlist.count({
      where: {
        ownerId: channelId,
        isPublic: true,
        isDeleted: false,
      },
    }),
    prisma.tweet.count({
      where: {
        ownerId: channelId,
        isDeleted: false,
      },
    }),
    prisma.like.count({
      where: {
        video: {
          is: publicAllVideoWhere,
        },
      },
    }),
    prisma.like.count({
      where: {
        tweet: {
          is: {
            ownerId: channelId,
            isDeleted: false,
          },
        },
      },
    }),
    prisma.comment.count({
      where: {
        isDeleted: false,
        video: {
          is: publicAllVideoWhere,
        },
      },
    }),
    prisma.comment.count({
      where: {
        isDeleted: false,
        tweet: {
          is: {
            ownerId: channelId,
            isDeleted: false,
          },
        },
      },
    }),
  ]);

  return {
    totalViews: videoAggregate?._sum?.views ?? 0,
    totalVideos: longVideosCount,
    totalShorts: shortsCount,
    totalUploads: longVideosCount + shortsCount,
    totalPlaylists: playlistsCount,
    totalTweets: tweetsCount,
    totalLikes: videoLikesCount + tweetLikesCount,
    totalComments: videoCommentsCount + tweetCommentsCount,
  };
};

const buildChannelProfileData = ({ channel, isSubscribed, stats }) => {
  const description = channel.channelDescription ?? null;
  const links = channel.channelLinks ?? null;
  const subscribersCount = channel._count.subscribers;

  return {
    id: channel.id,
    username: channel.username,
    fullName: channel.fullName,
    avatar: channel.avatar,
    coverImage: channel.coverImage,
    category: null,
    description,
    channelDescription: description,
    links,
    channelLinks: links,
    joinedAt: channel.createdAt,
    isSubscribed,
    subscribersCount,
    videosCount: stats.totalVideos,
    shortsCount: stats.totalShorts,
    playlistsCount: stats.totalPlaylists,
    tweetsCount: stats.totalTweets,
    totalViews: stats.totalViews,
    totalLikes: stats.totalLikes,
    totalComments: stats.totalComments,
    about: {
      description,
      links,
      joinedAt: channel.createdAt,
    },
    stats: {
      subscribersCount,
      joinedAt: channel.createdAt,
      ...stats,
    },
  };
};

const getChannelProfileWithCache = async ({
  channelId,
  userId,
  scope,
  message,
}) => {
  const cacheParams = {
    channelId,
    viewerId: userId || "anonymous",
  };

  const cached = await getCachedValue({
    scope,
    params: cacheParams,
  });

  if (cached.hit && cached.value) {
    return cached.value;
  }

  const [channel, isSubscribed, stats] = await Promise.all([
    getActiveChannelProfile(channelId),
    getIsSubscribed({ userId, channelId }),
    getChannelPublicStats(channelId),
  ]);

  const payload = {
    data: buildChannelProfileData({
      channel,
      isSubscribed,
      stats,
    }),
    message,
  };

  await setCachedValue({
    scope,
    params: cacheParams,
    value: payload,
    ttlSeconds: CHANNEL_INFO_CACHE_TTL_SECONDS,
  });

  return payload;
};

export const getChannelInfo = asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const userId = req.user?.id;

  const responsePayload = await getChannelProfileWithCache({
    channelId,
    userId,
    scope: "channel:info",
    message: "Channel info fetched",
  });

  return res
    .status(200)
    .json(new ApiResponse(200, responsePayload.data, responsePayload.message));
});

export const getChannelAbout = asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const userId = req.user?.id;

  const responsePayload = await getChannelProfileWithCache({
    channelId,
    userId,
    scope: "channel:about",
    message: "Channel about fetched",
  });

  return res
    .status(200)
    .json(new ApiResponse(200, responsePayload.data, responsePayload.message));
});

export const getChannelVideos = asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const sort = req.query?.sort || "latest";

  await ensureActiveChannelExists(channelId);

  const { page, limit, skip } = resolvePagination(req.query, {
    defaultLimit: CHANNEL_VIDEO_BASE_DEFAULT_LIMIT,
    maxLimit: CHANNEL_VIDEO_MAX_LIMIT,
  });

  const where = buildPublicVideoWhere({ channelId, isShort: false });
  const orderBy = resolveVideoOrderBy(sort);

  const [videos, total] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        thumbnail: true,
        views: true,
        createdAt: true,
        duration: true,
      },
    }),
    prisma.video.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        items: videos,
        currentPage: page,
        limit,
        totalItems: total,
      }),
      "Channel videos fetched"
    )
  );
});

export const getChannelShorts = asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const sort = req.query?.sort || "latest";

  await ensureActiveChannelExists(channelId);

  const { page, limit, skip } = resolvePagination(req.query, {
    defaultLimit: CHANNEL_SHORTS_DEFAULT_LIMIT,
    maxLimit: CHANNEL_SHORTS_MAX_LIMIT,
  });

  const where = buildPublicVideoWhere({ channelId, isShort: true });
  const orderBy = resolveVideoOrderBy(sort);

  const [shorts, total] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        thumbnail: true,
        views: true,
        createdAt: true,
        duration: true,
      },
    }),
    prisma.video.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        items: shorts,
        currentPage: page,
        limit,
        totalItems: total,
      }),
      "Channel shorts fetched"
    )
  );
});

export const getChannelPlaylists = asyncHandler(async (req, res) => {
  const { channelId } = req.params;

  await ensureActiveChannelExists(channelId);

  const { page, limit, skip } = resolvePagination(req.query, {
    defaultLimit: CHANNEL_PLAYLIST_DEFAULT_LIMIT,
    maxLimit: CHANNEL_PLAYLIST_MAX_LIMIT,
  });

  const where = {
    ownerId: channelId,
    isPublic: true,
    isDeleted: false,
  };

  const [playlists, total] = await Promise.all([
    prisma.playlist.findMany({
      where,
      skip,
      take: limit,
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        isPublic: true,
        videoCount: true,
        totalDuration: true,
        updatedAt: true,
        createdAt: true,
      },
    }),
    prisma.playlist.count({ where }),
  ]);

  const formattedPlaylists = playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    isPublic: playlist.isPublic,
    videoCount: playlist.videoCount,
    totalDuration: playlist.totalDuration,
    updatedAt: playlist.updatedAt,
    isWatchLater: playlist.name === "Watch Later",
  }));

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        items: formattedPlaylists,
        currentPage: page,
        limit,
        totalItems: total,
      }),
      "Channel playlists fetched successfully"
    )
  );
});

export const getChannelTweets = asyncHandler(async (req, res) => {
  const { channelId } = req.params;

  await ensureActiveChannelExists(channelId);

  const { page, limit, skip } = resolvePagination(req.query, {
    defaultLimit: CHANNEL_TWEET_DEFAULT_LIMIT,
    maxLimit: CHANNEL_TWEET_MAX_LIMIT,
  });

  const where = {
    ownerId: channelId,
    isDeleted: false,
  };

  const [tweets, total] = await Promise.all([
    prisma.tweet.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
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
            avatar: true,
          },
        },
      },
    }),
    prisma.tweet.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      buildPaginatedListData({
        items: tweets,
        currentPage: page,
        limit,
        totalItems: total,
      }),
      "Channel tweets fetched successfully"
    )
  );
});

