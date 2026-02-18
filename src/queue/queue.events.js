import { QueueEvents } from "bullmq";
import { getRedisConnection } from "./redis.connection.js";

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const shouldRunWorker = parseBool(
  process.env.RUN_WORKER,
  process.env.NODE_ENV !== "production"
);

const skipVersionCheck = parseBool(
  process.env.BULLMQ_SKIP_VERSION_CHECK,
  process.env.NODE_ENV === "production"
);

const redisConnection = shouldRunWorker ? getRedisConnection() : null;

export const videoQueueEvents = redisConnection && shouldRunWorker
  ? new QueueEvents("video-processing", {
      connection: redisConnection,
      skipVersionCheck,
    })
  : null;

if (videoQueueEvents) {
  videoQueueEvents.on("completed", ({ jobId }) => {
    console.log("Job completed:", jobId);
  });

  videoQueueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error("Job failed:", jobId, failedReason);
  });

  videoQueueEvents.on("waiting", ({ jobId }) => {
    console.log("Job waiting:", jobId);
  });
}
