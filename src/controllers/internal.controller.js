import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { metrics } from "../observability/usage.metrics.js";
import {
  isCacheEnabled,
  isQueueEnabled,
  isRedisCacheEnabled,
  isRedisEnabled,
  isRedisHardDisabled,
} from "../queue/redis.connection.js";
import { getVideoQueue } from "../queue/video.queue.js";

const normalizeToken = (value) => String(value || "").trim();

const assertInternalAuth = (req) => {
  const expectedToken = normalizeToken(process.env.INTERNAL_METRICS_TOKEN);
  if (!expectedToken) {
    throw new ApiError(503, "Internal metrics endpoint is not configured");
  }

  const provided =
    normalizeToken(req.header("x-internal-token")) ||
    normalizeToken(req.header("authorization")).replace(/^Bearer\s+/i, "");

  if (!provided || provided !== expectedToken) {
    throw new ApiError(401, "Unauthorized");
  }
};

const getAiDbUsageToday = async () => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [chat, summary] = await Promise.all([
    prisma.backgroundJob.count({
      where: {
        jobType: "AI_CHAT",
        createdAt: { gte: dayStart },
      },
    }),
    prisma.backgroundJob.count({
      where: {
        jobType: "AI_SUMMARY",
        createdAt: { gte: dayStart },
      },
    }),
  ]);

  return {
    total: chat + summary,
    chat,
    summary,
    dayStart: dayStart.toISOString(),
  };
};

const getQueueStats = async () => {
  const queue = getVideoQueue();
  if (!queue) {
    return {
      enabled: false,
      counts: null,
    };
  }

  try {
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused"
    );
    return {
      enabled: true,
      counts,
    };
  } catch (error) {
    return {
      enabled: true,
      counts: null,
      error: error?.message || "Failed to fetch queue stats",
    };
  }
};

export const getInternalUsage = asyncHandler(async (req, res) => {
  assertInternalAuth(req);

  const [aiDbUsage, queueStats] = await Promise.all([
    getAiDbUsageToday(),
    getQueueStats(),
  ]);

  const snapshot = metrics.snapshot();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        runtime: {
          nodeEnv: process.env.NODE_ENV || "development",
          timezone: process.env.TZ || "system",
        },
        flags: {
          redisEnabled: isRedisEnabled,
          redisCacheEnabled: isRedisCacheEnabled,
          cacheEnabled: isCacheEnabled,
          queueEnabled: isQueueEnabled,
          redisHardDisabled: isRedisHardDisabled(),
        },
        usage: snapshot,
        aiDbUsageToday: aiDbUsage,
        queue: queueStats,
      },
      "Internal usage snapshot"
    )
  );
});

