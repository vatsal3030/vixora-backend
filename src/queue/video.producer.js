import { getVideoQueue } from "./video.queue.js";
import { metrics } from "../observability/usage.metrics.js";

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const parsePositiveInt = (value, fallbackValue) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallbackValue;
  return parsed;
};

const shouldRunWorkerOnDemand = parseBool(
  process.env.RUN_WORKER_ON_DEMAND,
  process.env.NODE_ENV === "production"
);
const queueMaxWaitingJobs = parsePositiveInt(
  process.env.QUEUE_MAX_WAITING_JOBS,
  process.env.NODE_ENV === "production" ? 25 : 200
);

export const enqueueVideoProcessing = async ({
  videoId,
  userId,
  videoUrl,
}) => {
  metrics.recordQueueEvent("enqueueAttempts");

  if (shouldRunWorkerOnDemand) {
    const { startVideoWorker } = await import("../jobs/video.worker.js");
    await startVideoWorker({ force: true });
  }

  const videoQueue = getVideoQueue();

  if (!videoQueue) {
    metrics.recordQueueEvent("enqueueSkippedNoQueue");
    return null;
  }

  try {
    const counts = await videoQueue.getJobCounts("waiting", "active", "delayed");
    const inFlight =
      Number(counts?.waiting || 0) +
      Number(counts?.active || 0) +
      Number(counts?.delayed || 0);

    if (inFlight >= queueMaxWaitingJobs) {
      metrics.recordQueueEvent("enqueueRejectedBudget");
      return null;
    }
  } catch {
    // If counts fail, continue enqueue path and let queue decide.
  }

  const job = await videoQueue.add(
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
  metrics.recordQueueEvent("enqueued");
  return job;
};
