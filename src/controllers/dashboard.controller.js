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
    }, "overview successfully fetched "));
});

export const getAnalytics = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const period = req.query.period || "7d";

  const daysMap = {
    "7d": 7,
    "30d": 30,
    "90d": 90
  };

  const days = daysMap[period] || 7;

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  const videos = await prisma.video.findMany({
    where: {
      ownerId: userId,
      createdAt: { gte: fromDate }
    },
    select: {
      createdAt: true,
      views: true
    }
  });

  const analytics = {};

  videos.forEach(v => {
    const date = v.createdAt.toISOString().split("T")[0];
    analytics[date] = (analytics[date] || 0) + v.views;
  });

  return res.status(200).json(
    new ApiResponse(200, analytics, "analytics successfully fetched")
  );
});

export const getTopVideos = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const limit = parseInt(req.query.limit) || 5;

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

  return res.status(200).json(
    new ApiResponse(200, videos, "top videos successfully fetched")
  );

});

export const getGrowthStats = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const videos = await prisma.video.findMany({
    where: { ownerId: userId },
    select: { createdAt: true }
  });

  const growth = {};

  videos.forEach(v => {
    const date = v.createdAt.toISOString().split("T")[0];
    growth[date] = (growth[date] || 0) + 1;
  });

  return res.status(200).json(
    new ApiResponse(200, growth, "growth successfully fetched")
  );
});

export const getInsights = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const videos = await prisma.video.findMany({
    where: { ownerId: userId },
    select: {
      views: true,
      comments: true,
      likes: true
    }
  });

  const totalVideos = videos.length;
  const totalViews = videos.reduce((a, b) => a + b.views, 0);
  const totalLikes = videos.reduce((a, b) => a + b.likes.length, 0);
  const totalComments = videos.reduce((a, b) => a + b.comments.length, 0);

  return res.status(200).json(
    new ApiResponse(200, {
      avgViews: totalVideos ? Math.round(totalViews / totalVideos) : 0,
      engagementRate:
        totalViews > 0
          ? ((totalLikes + totalComments) / totalViews).toFixed(2)
          : 0
    }, "insights successfully fetched")
  );

});

