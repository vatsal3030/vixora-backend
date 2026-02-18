import { getVideoQueue } from "./video.queue.js";

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const shouldRunWorkerOnDemand = parseBool(
  process.env.RUN_WORKER_ON_DEMAND,
  process.env.NODE_ENV === "production"
);

export const enqueueVideoProcessing = async ({
  videoId,
  userId,
  videoUrl,
}) => {
  if (shouldRunWorkerOnDemand) {
    const { startVideoWorker } = await import("../jobs/video.worker.js");
    await startVideoWorker({ force: true });
  }

  const videoQueue = getVideoQueue();

  if (!videoQueue) {
    return null;
  }

  return videoQueue.add(
    "process-video",
    {
      videoId,
      userId,
      videoUrl,
    },
    {
      jobId: `video-${videoId}`, // idempotent
    }
  );
};
