import { Worker } from "bullmq";
import { getRedisConnection } from "../queue/redis.connection.js";
import prisma from "../db/prisma.js";
import { generateVideoThumbnail } from "../utils/cloudinaryThumbnail.js";

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const shouldRunWorkerDefault = process.env.NODE_ENV !== "production";
const shouldRunWorker = parseBool(process.env.RUN_WORKER, shouldRunWorkerDefault);
const shouldRunWorkerOnDemand = parseBool(
  process.env.RUN_WORKER_ON_DEMAND,
  process.env.NODE_ENV === "production"
);
const workerIdleShutdownMs = Number(process.env.WORKER_IDLE_SHUTDOWN_MS || 45000);
const shouldAutoShutdown =
  Number.isFinite(workerIdleShutdownMs) && workerIdleShutdownMs > 0;
const skipVersionCheck = parseBool(
  process.env.BULLMQ_SKIP_VERSION_CHECK,
  process.env.NODE_ENV === "production"
);

let workerInstance = null;
let idleShutdownTimer = null;

const clearIdleShutdownTimer = () => {
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }
};

const checkIfCancelled = async (videoId) => {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { processingStatus: true },
  });

  if (!video) throw new Error("VIDEO_NOT_FOUND");
  if (video.processingStatus === "CANCELLED") throw new Error("PROCESSING_CANCELLED");
};

const processJob = async (job) => {
      const { videoId } = job.data;

      console.log("Background processing started:", videoId);

      try {
        await checkIfCancelled(videoId);

        await prisma.video.update({
          where: { id: videoId },
          data: {
            processingStatus: "PROCESSING",
            processingStartedAt: new Date(),
            processingProgress: 10,
            processingStep: "BACKGROUND_TASKS",
          },
        });

        await checkIfCancelled(videoId);

        await prisma.videoAnalyticsSnapshot.create({
          data: {
            videoId,
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            watchTimeSeconds: 0,
            snapshotDate: new Date(),
          },
        });

        await checkIfCancelled(videoId);

        const video = await prisma.video.findUnique({
          where: { id: videoId },
          select: { thumbnail: true, videoFile: true },
        });

        if (!video) {
          throw new Error("VIDEO_DELETED_DURING_PROCESSING");
        }

        if (!video.thumbnail && video.videoFile) {
          const autoThumbnail = generateVideoThumbnail(video.videoFile);
          await prisma.video.update({
            where: { id: videoId },
            data: { thumbnail: autoThumbnail },
          });
        }

        await prisma.video.update({
          where: { id: videoId },
          data: {
            processingStatus: "COMPLETED",
            processingCompletedAt: new Date(),
            processingProgress: 100,
            processingStep: "DONE",
            isPublished: true,
            isHlsReady: true,
          },
        });

        console.log("Background processing completed:", videoId);
        return true;
      } catch (error) {
        if (error.message === "VIDEO_DELETED_DURING_PROCESSING") {
          console.log("Video deleted during processing:", videoId);
          return;
        }

        if (error.message === "PROCESSING_CANCELLED") {
          console.log("Processing cancelled:", videoId);
          return;
        }

        console.error("Worker error:", error);

        await prisma.video.update({
          where: { id: videoId },
          data: {
            processingStatus: "FAILED",
            processingError: error.message,
          },
        });

        throw error;
      }
    };

const scheduleIdleShutdown = () => {
  if (!shouldAutoShutdown || !workerInstance || !shouldRunWorkerOnDemand) return;

  clearIdleShutdownTimer();
  idleShutdownTimer = setTimeout(() => {
    stopVideoWorker().catch((error) => {
      console.error("Failed to stop idle worker:", error?.message || error);
    });
  }, workerIdleShutdownMs);
};

export const startVideoWorker = async ({ force = false } = {}) => {
  if (workerInstance) {
    return workerInstance;
  }

  const canStart = force
    ? shouldRunWorkerOnDemand || shouldRunWorker
    : shouldRunWorker;

  if (!canStart) {
    return null;
  }

  const redisConnection = getRedisConnection();

  if (!redisConnection) {
    console.log("Video worker skipped: Redis is not configured.");
    return null;
  }

  workerInstance = new Worker(
    "video-processing",
    processJob,
    {
      connection: redisConnection,
      concurrency: 2,
      skipVersionCheck,
    }
  );

  workerInstance.on("error", (err) => {
    console.error("Video worker runtime error:", err?.message || err);
  });

  workerInstance.on("active", () => {
    clearIdleShutdownTimer();
  });

  workerInstance.on("drained", () => {
    scheduleIdleShutdown();
  });

  workerInstance.on("closed", () => {
    clearIdleShutdownTimer();
    workerInstance = null;
  });

  console.log("Cloudinary background worker started.");

  return workerInstance;
};

export const stopVideoWorker = async () => {
  clearIdleShutdownTimer();

  if (!workerInstance) {
    return;
  }

  const closingWorker = workerInstance;
  workerInstance = null;

  await closingWorker.close();
  console.log("Cloudinary background worker stopped after idle timeout.");
};

if (shouldRunWorker) {
  startVideoWorker().catch((error) => {
    console.error("Video worker bootstrap failed:", error?.message || error);
  });
} else if (shouldRunWorkerOnDemand) {
  console.log("Video worker on-demand mode is enabled.");
} else {
  console.log("Video worker disabled by RUN_WORKER.");
}
