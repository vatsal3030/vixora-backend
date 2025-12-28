import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"

export const getDashboardOverview = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [
    totalVideos,
    totalViews,
    totalLikesOnVideos,
    totalLikesOnTweet,
    totalComments,
    subscribers
  ] = await Promise.all([
    prisma.video.count({ where: { ownerId: userId } }),

    prisma.video.aggregate({
      where: { ownerId: userId },
      _sum: { views: true }
    }),

    prisma.like.count({
      where: { video: { ownerId: userId } }
    }),

    prisma.like.count({
      where: { tweet: { ownerId: userId } }
    }),

    prisma.comment.count({
      where: { video: { ownerId: userId } }
    }),

    prisma.subscription.count({
      where: { channelId: userId }
    })
  ]);

  return res.status(200).json(
    new ApiResponse(200, {
      totalVideos,
      totalViews: totalViews._sum.views || 0,
      totalLikesOnVideos,
      totalLikesOnTweet,
      totalComments,
      subscribers
    }, "Dashboard overview fetched")
  );
});

export const getAnalytics = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const period = req.query.period || "7d";

  const daysMap = { "7d": 7, "30d": 30, "90d": 90 };
  const days = daysMap[period] || 7;

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  const data = await prisma.video.groupBy({
    by: ["createdAt"],
    where: {
      ownerId: userId,
      createdAt: { gte: fromDate }
    },
    _sum: { views: true },
    orderBy: { createdAt: "asc" }
  });

  const analytics = data.map(d => ({
    date: d.createdAt.toISOString().split("T")[0],
    views: d._sum.views || 0
  }));

  res.status(200).json(
    new ApiResponse(200, analytics, "Analytics fetched")
  );
});

export const getTopVideos = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);

  const videos = await prisma.video.findMany({
    where: { ownerId: userId },
    orderBy: { views: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      views: true,
      thumbnail: true,
      createdAt: true
    }
  });

  res.status(200).json(
    new ApiResponse(200, videos, "Top videos fetched")
  );
});

export const getGrowthStats = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const data = await prisma.video.groupBy({
    by: ["createdAt"],
    where: { ownerId: userId },
    _count: { _all: true },
    orderBy: { createdAt: "asc" }
  });

  const growth = data.map(d => ({
    date: d.createdAt.toISOString().split("T")[0],
    count: d._count._all
  }));

  res.status(200).json(
    new ApiResponse(200, growth, "Growth stats fetched")
  );
});

export const getInsights = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [videos, likes, comments] = await Promise.all([
    prisma.video.aggregate({
      where: { ownerId: userId },
      _count: true,
      _sum: { views: true }
    }),

    prisma.like.count({
      where: { video: { ownerId: userId } }
    }),

    prisma.comment.count({
      where: { video: { ownerId: userId } }
    })
  ]);

  const totalVideos = videos._count;
  const totalViews = videos._sum.views || 0;

  res.status(200).json(
    new ApiResponse(200, {
      avgViews: totalVideos ? Math.round(totalViews / totalVideos) : 0,
      avgLikes: likes ? Math.round(likes / totalVideos) : 0,
      engagementRate:
        totalViews > 0
          ? ((likes + comments) / totalViews).toFixed(2)
          : 0
    }, "Insights fetched")
  );
});
