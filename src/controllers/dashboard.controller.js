import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { buildPaginatedListData } from "../utils/listResponse.js";

const ACTIVE_VIDEO_WHERE = (userId) => ({
  ownerId: userId,
  isDeleted: false,
  processingStatus: "COMPLETED",
  isHlsReady: true,
});

const PERIOD_TO_DAYS = Object.freeze({
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
});

const DAY_MS = 24 * 60 * 60 * 1000;

const resolvePeriodOrThrow = (rawPeriod, fallback = "7d") => {
  const period = String(rawPeriod || fallback)
    .trim()
    .toLowerCase();
  const days = PERIOD_TO_DAYS[period];

  if (!days) {
    throw new ApiError(400, "Invalid period. Allowed: 7d, 30d, 90d, 1y");
  }

  return { period, days };
};

const resolvePositiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const toISODate = (value) => new Date(value).toISOString().split("T")[0];

const formatDayLabel = (isoDate) => {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

const buildDateRangeForDays = (days) => {
  const now = new Date();
  const end = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);

  return { start, end };
};

const getComparisonRange = ({ start, days }) => {
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * DAY_MS);
  previousStart.setUTCHours(0, 0, 0, 0);
  previousEnd.setUTCHours(23, 59, 59, 999);
  return { previousStart, previousEnd };
};

const createDailyBuckets = ({ start, end }) => {
  const map = new Map();

  for (let ts = start.getTime(); ts <= end.getTime(); ts += DAY_MS) {
    const key = toISODate(ts);
    map.set(key, 0);
  }

  return map;
};

const incrementDailyBucket = (bucket, when, increment = 1) => {
  const key = toISODate(when);
  if (!bucket.has(key)) return;
  bucket.set(key, Number(bucket.get(key) || 0) + Number(increment || 0));
};

const toSeries = (bucket) =>
  [...bucket.entries()].map(([date, value]) => ({
    date,
    label: formatDayLabel(date),
    value,
  }));

const sumBucket = (bucket) =>
  [...bucket.values()].reduce((sum, value) => sum + Number(value || 0), 0);

const buildTrend = ({ current, previous }) => {
  const change = current - previous;
  const changePercent =
    previous > 0
      ? Number(((change / previous) * 100).toFixed(2))
      : current > 0
      ? 100
      : 0;

  return {
    current,
    previous,
    change,
    changePercent,
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
};

const getActiveVideoIds = async (userId) => {
  const rows = await prisma.video.findMany({
    where: ACTIVE_VIDEO_WHERE(userId),
    select: { id: true },
  });

  return rows.map((row) => row.id);
};

const buildChartFromSeries = (seriesMap) => {
  const [firstSeries] = Object.values(seriesMap);
  if (!firstSeries || firstSeries.length === 0) return [];

  return firstSeries.map((point, index) => ({
    date: point.date,
    label: point.label,
    views: seriesMap.views?.[index]?.value ?? 0,
    subscribers: seriesMap.subscribers?.[index]?.value ?? 0,
    likes: seriesMap.likes?.[index]?.value ?? 0,
  }));
};

const resolveDashboardContext = (userId, context = {}) => ({
  activeVideoWhere: context.activeVideoWhere || ACTIVE_VIDEO_WHERE(userId),
  activeVideoIdsPromise: context.activeVideoIdsPromise || getActiveVideoIds(userId),
});

const buildOverviewData = async ({ userId, rawPeriod, context }) => {
  const { activeVideoWhere, activeVideoIdsPromise } = resolveDashboardContext(
    userId,
    context
  );
  const { period, days } = resolvePeriodOrThrow(rawPeriod, "7d");
  const { start, end } = buildDateRangeForDays(days);
  const { previousStart, previousEnd } = getComparisonRange({ start, days });

  const [
    videoIds,
    totalVideos,
    totalViewsAggregate,
    totalLikes,
    totalComments,
    totalSubscribers,
    currentSubscribers,
    previousSubscribers,
    currentLikes,
    previousLikes,
    currentNewVideos,
    previousNewVideos,
  ] = await Promise.all([
    activeVideoIdsPromise,
    prisma.video.count({ where: activeVideoWhere }),
    prisma.video.aggregate({
      where: activeVideoWhere,
      _sum: { views: true },
    }),
    prisma.like.count({
      where: { video: { is: activeVideoWhere } },
    }),
    prisma.comment.count({
      where: { video: { is: activeVideoWhere }, isDeleted: false },
    }),
    prisma.subscription.count({
      where: { channelId: userId },
    }),
    prisma.subscription.count({
      where: {
        channelId: userId,
        createdAt: { gte: start, lte: end },
      },
    }),
    prisma.subscription.count({
      where: {
        channelId: userId,
        createdAt: { gte: previousStart, lte: previousEnd },
      },
    }),
    prisma.like.count({
      where: {
        video: { is: activeVideoWhere },
        createdAt: { gte: start, lte: end },
      },
    }),
    prisma.like.count({
      where: {
        video: { is: activeVideoWhere },
        createdAt: { gte: previousStart, lte: previousEnd },
      },
    }),
    prisma.video.count({
      where: {
        ...activeVideoWhere,
        createdAt: { gte: start, lte: end },
      },
    }),
    prisma.video.count({
      where: {
        ...activeVideoWhere,
        createdAt: { gte: previousStart, lte: previousEnd },
      },
    }),
  ]);

  let currentViews = 0;
  let previousViews = 0;

  if (videoIds.length > 0) {
    [currentViews, previousViews] = await Promise.all([
      prisma.watchHistory.count({
        where: {
          videoId: { in: videoIds },
          lastWatchedAt: { gte: start, lte: end },
        },
      }),
      prisma.watchHistory.count({
        where: {
          videoId: { in: videoIds },
          lastWatchedAt: { gte: previousStart, lte: previousEnd },
        },
      }),
    ]);
  }

  const totalViews = Number(totalViewsAggregate?._sum?.views || 0);

  return {
    period,
    dateRange: {
      from: toISODate(start),
      to: toISODate(end),
      previousFrom: toISODate(previousStart),
      previousTo: toISODate(previousEnd),
    },
    cards: {
      subscribers: {
        value: totalSubscribers,
        trend: buildTrend({
          current: currentSubscribers,
          previous: previousSubscribers,
        }),
      },
      views: {
        value: totalViews,
        trend: buildTrend({
          current: currentViews,
          previous: previousViews,
        }),
      },
      likes: {
        value: totalLikes,
        trend: buildTrend({
          current: currentLikes,
          previous: previousLikes,
        }),
      },
      videos: {
        value: totalVideos,
        trend: buildTrend({
          current: currentNewVideos,
          previous: previousNewVideos,
        }),
      },
    },
    totals: {
      totalVideos,
      totalViews,
      totalLikes,
      totalComments,
      totalSubscribers,
    },
    // legacy aliases
    totalVideos,
    totalViews,
    totalLikesOnVideos: totalLikes,
    totalComments,
    subscribers: totalSubscribers,
  };
};

const buildAnalyticsData = async ({ userId, rawPeriod, context }) => {
  const { activeVideoIdsPromise } = resolveDashboardContext(userId, context);
  const { period, days } = resolvePeriodOrThrow(rawPeriod, "7d");
  const { start, end } = buildDateRangeForDays(days);

  const [videoIds, subscriberRows] = await Promise.all([
    activeVideoIdsPromise,
    prisma.subscription.findMany({
      where: {
        channelId: userId,
        createdAt: { gte: start, lte: end },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  let likeRows = [];
  let viewRows = [];

  if (videoIds.length > 0) {
    [likeRows, viewRows] = await Promise.all([
      prisma.like.findMany({
        where: {
          videoId: { in: videoIds },
          createdAt: { gte: start, lte: end },
        },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.watchHistory.findMany({
        where: {
          videoId: { in: videoIds },
          lastWatchedAt: { gte: start, lte: end },
        },
        select: { lastWatchedAt: true },
        orderBy: { lastWatchedAt: "asc" },
      }),
    ]);
  }

  const viewsBucket = createDailyBuckets({ start, end });
  const subscribersBucket = createDailyBuckets({ start, end });
  const likesBucket = createDailyBuckets({ start, end });

  for (const row of viewRows) incrementDailyBucket(viewsBucket, row.lastWatchedAt, 1);
  for (const row of subscriberRows) incrementDailyBucket(subscribersBucket, row.createdAt, 1);
  for (const row of likeRows) incrementDailyBucket(likesBucket, row.createdAt, 1);

  const series = {
    views: toSeries(viewsBucket),
    subscribers: toSeries(subscribersBucket),
    likes: toSeries(likesBucket),
  };

  return {
    period,
    dateRange: {
      from: toISODate(start),
      to: toISODate(end),
    },
    summary: {
      views: sumBucket(viewsBucket),
      subscribers: sumBucket(subscribersBucket),
      likes: sumBucket(likesBucket),
    },
    series,
    chart: buildChartFromSeries(series),
  };
};

const buildTopVideosData = async ({
  userId,
  rawPeriod,
  page: rawPage,
  limit: rawLimit,
  sortBy: rawSortBy,
  sortOrder: rawSortOrder,
  context,
}) => {
  const { activeVideoWhere } = resolveDashboardContext(userId, context);
  const { period, days } = resolvePeriodOrThrow(rawPeriod, "30d");
  const { start, end } = buildDateRangeForDays(days);

  const page = resolvePositiveInt(rawPage, 1, 1000);
  const limit = resolvePositiveInt(rawLimit, 10, 20);
  const sortBy = String(rawSortBy || "views").trim().toLowerCase();
  const sortOrder =
    String(rawSortOrder || "desc").trim().toLowerCase() === "asc" ? "asc" : "desc";

  const allowedSortBy = new Set(["views", "likes", "comments", "engagement"]);
  if (!allowedSortBy.has(sortBy)) {
    throw new ApiError(400, "Invalid sortBy. Allowed: views, likes, comments, engagement");
  }

  const candidateVideos = await prisma.video.findMany({
    where: activeVideoWhere,
    select: {
      id: true,
      title: true,
      thumbnail: true,
      views: true,
      createdAt: true,
    },
    orderBy: { views: "desc" },
    take: 100,
  });

  const videoIds = candidateVideos.map((video) => video.id);
  if (videoIds.length === 0) {
    return buildPaginatedListData({
      items: [],
      currentPage: page,
      limit,
      totalItems: 0,
      extra: {
        period,
        sortBy,
        sortOrder,
      },
    });
  }

  const [
    allLikesGroup,
    allCommentsGroup,
    periodLikesGroup,
    periodCommentsGroup,
    periodViewsGroup,
  ] = await Promise.all([
    prisma.like.groupBy({
      by: ["videoId"],
      where: { videoId: { in: videoIds } },
      _count: { _all: true },
    }),
    prisma.comment.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: videoIds },
        isDeleted: false,
      },
      _count: { _all: true },
    }),
    prisma.like.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: videoIds },
        createdAt: { gte: start, lte: end },
      },
      _count: { _all: true },
    }),
    prisma.comment.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: videoIds },
        isDeleted: false,
        createdAt: { gte: start, lte: end },
      },
      _count: { _all: true },
    }),
    prisma.watchHistory.groupBy({
      by: ["videoId"],
      where: {
        videoId: { in: videoIds },
        lastWatchedAt: { gte: start, lte: end },
      },
      _count: { _all: true },
    }),
  ]);

  const toCountMap = (rows) =>
    rows.reduce((acc, row) => {
      acc.set(row.videoId, Number(row?._count?._all || 0));
      return acc;
    }, new Map());

  const allLikesMap = toCountMap(allLikesGroup);
  const allCommentsMap = toCountMap(allCommentsGroup);
  const periodLikesMap = toCountMap(periodLikesGroup);
  const periodCommentsMap = toCountMap(periodCommentsGroup);
  const periodViewsMap = toCountMap(periodViewsGroup);

  const rows = candidateVideos.map((video) => {
    const likes = allLikesMap.get(video.id) || 0;
    const comments = allCommentsMap.get(video.id) || 0;
    const engagement = video.views > 0 ? (likes + comments) / video.views : 0;

    return {
      id: video.id,
      title: video.title,
      thumbnail: video.thumbnail,
      createdAt: video.createdAt,
      metrics: {
        views: video.views,
        likes,
        comments,
        engagement: Number(engagement.toFixed(4)),
      },
      periodMetrics: {
        views: periodViewsMap.get(video.id) || 0,
        likes: periodLikesMap.get(video.id) || 0,
        comments: periodCommentsMap.get(video.id) || 0,
      },
    };
  });

  const direction = sortOrder === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const aValue = a.metrics[sortBy];
    const bValue = b.metrics[sortBy];
    if (aValue === bValue) {
      return b.createdAt.getTime() - a.createdAt.getTime();
    }
    return aValue > bValue ? direction : -direction;
  });

  const totalItems = rows.length;
  const skip = (page - 1) * limit;
  const paged = rows.slice(skip, skip + limit);

  return buildPaginatedListData({
    items: paged,
    currentPage: page,
    limit,
    totalItems,
    extra: {
      period,
      sortBy,
      sortOrder,
    },
  });
};

const buildGrowthData = async ({ userId, rawPeriod, context }) => {
  const { activeVideoWhere, activeVideoIdsPromise } = resolveDashboardContext(
    userId,
    context
  );
  const { period, days } = resolvePeriodOrThrow(rawPeriod, "90d");
  const { start, end } = buildDateRangeForDays(days);
  const videoIds = await activeVideoIdsPromise;

  let likesRows = [];
  if (videoIds.length > 0) {
    likesRows = await prisma.like.findMany({
      where: {
        videoId: { in: videoIds },
        createdAt: { gte: start, lte: end },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  const [subscriberRows, videoRows] = await Promise.all([
    prisma.subscription.findMany({
      where: {
        channelId: userId,
        createdAt: { gte: start, lte: end },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.video.findMany({
      where: {
        ...activeVideoWhere,
        createdAt: { gte: start, lte: end },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const subscribersDaily = createDailyBuckets({ start, end });
  const videosDaily = createDailyBuckets({ start, end });
  const likesDaily = createDailyBuckets({ start, end });

  for (const row of subscriberRows) incrementDailyBucket(subscribersDaily, row.createdAt, 1);
  for (const row of videoRows) incrementDailyBucket(videosDaily, row.createdAt, 1);
  for (const row of likesRows) incrementDailyBucket(likesDaily, row.createdAt, 1);

  const toCumulativeSeries = (dailySeries) => {
    let running = 0;
    return dailySeries.map((point) => {
      running += point.value;
      return { ...point, value: running };
    });
  };

  const subscribersSeries = toSeries(subscribersDaily);
  const videosSeries = toSeries(videosDaily);
  const likesSeries = toSeries(likesDaily);

  return {
    period,
    dateRange: {
      from: toISODate(start),
      to: toISODate(end),
    },
    daily: {
      subscribers: subscribersSeries,
      videos: videosSeries,
      likes: likesSeries,
    },
    cumulative: {
      subscribers: toCumulativeSeries(subscribersSeries),
      videos: toCumulativeSeries(videosSeries),
      likes: toCumulativeSeries(likesSeries),
    },
    totals: {
      subscribers: sumBucket(subscribersDaily),
      videos: sumBucket(videosDaily),
      likes: sumBucket(likesDaily),
    },
  };
};

const buildInsightsData = async ({ userId, context }) => {
  const { activeVideoWhere } = resolveDashboardContext(userId, context);

  const [videos, likes, comments, totalViewsAggregate] = await Promise.all([
    prisma.video.findMany({
      where: activeVideoWhere,
      select: {
        id: true,
        title: true,
        createdAt: true,
        views: true,
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    }),
    prisma.like.count({
      where: { video: { is: activeVideoWhere } },
    }),
    prisma.comment.count({
      where: { video: { is: activeVideoWhere }, isDeleted: false },
    }),
    prisma.video.aggregate({
      where: activeVideoWhere,
      _sum: { views: true },
    }),
  ]);

  const totalVideos = videos.length;
  const totalViews = Number(totalViewsAggregate?._sum?.views || 0);
  const engagementRate =
    totalViews > 0 ? Number((((likes + comments) / totalViews) * 100).toFixed(2)) : 0;

  let bestUploadDay = null;
  if (totalVideos > 0) {
    const viewsByWeekday = new Map();

    for (const video of videos) {
      const weekday = new Date(video.createdAt).toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: "UTC",
      });
      const current = viewsByWeekday.get(weekday) || { views: 0, count: 0 };
      viewsByWeekday.set(weekday, {
        views: current.views + Number(video.views || 0),
        count: current.count + 1,
      });
    }

    let winner = { day: null, avgViews: -1 };
    for (const [day, data] of viewsByWeekday.entries()) {
      const avgViews = data.count ? data.views / data.count : 0;
      if (avgViews > winner.avgViews) {
        winner = { day, avgViews };
      }
    }

    bestUploadDay = winner.day
      ? {
          day: winner.day,
          avgViews: Math.round(winner.avgViews),
        }
      : null;
  }

  const topByLikes = [...videos].sort(
    (a, b) => (b._count.likes || 0) - (a._count.likes || 0)
  )[0];
  const topByComments = [...videos].sort(
    (a, b) => (b._count.comments || 0) - (a._count.comments || 0)
  )[0];

  const recommendations = [];
  if (engagementRate < 5) {
    recommendations.push("Try stronger CTAs in videos to increase likes and comments.");
  }
  if (totalVideos < 5) {
    recommendations.push("Increase upload consistency; target at least 1-2 uploads per week.");
  }
  if (totalViews > 0 && likes / Math.max(totalViews, 1) < 0.03) {
    recommendations.push("Optimize hooks and titles to improve viewer-to-like conversion.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Performance is stable. Continue current cadence and test new formats.");
  }

  return {
    avgViews: totalVideos ? Math.round(totalViews / totalVideos) : 0,
    avgLikes: totalVideos ? Math.round(likes / totalVideos) : 0,
    avgComments: totalVideos ? Math.round(comments / totalVideos) : 0,
    engagementRate,
    totals: {
      videos: totalVideos,
      views: totalViews,
      likes,
      comments,
    },
    bestUploadDay,
    topByLikes: topByLikes
      ? {
          videoId: topByLikes.id,
          title: topByLikes.title,
          likes: topByLikes._count.likes || 0,
        }
      : null,
    topByComments: topByComments
      ? {
          videoId: topByComments.id,
          title: topByComments.title,
          comments: topByComments._count.comments || 0,
        }
      : null,
    recommendations,
  };
};

export const getDashboardOverview = asyncHandler(async (req, res) => {
  const data = await buildOverviewData({
    userId: req.user.id,
    rawPeriod: req.query.period,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Dashboard overview fetched"));
});

export const getAnalytics = asyncHandler(async (req, res) => {
  const data = await buildAnalyticsData({
    userId: req.user.id,
    rawPeriod: req.query.period,
  });

  return res.status(200).json(new ApiResponse(200, data, "Analytics fetched"));
});

export const getTopVideos = asyncHandler(async (req, res) => {
  const data = await buildTopVideosData({
    userId: req.user.id,
    rawPeriod: req.query.period,
    page: req.query.page,
    limit: req.query.limit,
    sortBy: req.query.sortBy,
    sortOrder: req.query.sortOrder,
  });

  return res.status(200).json(new ApiResponse(200, data, "Top videos fetched"));
});

export const getGrowthStats = asyncHandler(async (req, res) => {
  const data = await buildGrowthData({
    userId: req.user.id,
    rawPeriod: req.query.period,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Growth stats fetched"));
});

export const getInsights = asyncHandler(async (req, res) => {
  const data = await buildInsightsData({
    userId: req.user.id,
  });

  return res.status(200).json(new ApiResponse(200, data, "Insights fetched"));
});

export const getDashboardFull = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const context = {
    activeVideoWhere: ACTIVE_VIDEO_WHERE(userId),
    activeVideoIdsPromise: getActiveVideoIds(userId),
  };

  const topVideosQuery = {
    page: req.query.topVideosPage ?? req.query.page,
    limit: req.query.topVideosLimit ?? req.query.limit,
    sortBy: req.query.topVideosSortBy ?? req.query.sortBy,
    sortOrder: req.query.topVideosSortOrder ?? req.query.sortOrder,
  };

  const [overview, analytics, topVideos, growth, insights] = await Promise.all([
    buildOverviewData({ userId, rawPeriod: req.query.period, context }),
    buildAnalyticsData({ userId, rawPeriod: req.query.period, context }),
    buildTopVideosData({
      userId,
      rawPeriod: req.query.period,
      page: topVideosQuery.page,
      limit: topVideosQuery.limit,
      sortBy: topVideosQuery.sortBy,
      sortOrder: topVideosQuery.sortOrder,
      context,
    }),
    buildGrowthData({ userId, rawPeriod: req.query.period, context }),
    buildInsightsData({ userId, context }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        period: overview.period,
        generatedAt: new Date().toISOString(),
        overview,
        analytics,
        topVideos,
        growth,
        insights,
      },
      "Dashboard full payload fetched"
    )
  );
});
