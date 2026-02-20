import { Queue } from "bullmq";
import { getRedisConnection } from "./redis.connection.js";

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const shouldRunWorker = parseBool(
  process.env.RUN_WORKER,
  process.env.NODE_ENV !== "production"
);
const shouldRunWorkerOnDemand = parseBool(
  process.env.RUN_WORKER_ON_DEMAND,
  process.env.NODE_ENV === "production"
);
const queueEnabled = parseBool(
  process.env.QUEUE_ENABLED,
  shouldRunWorker || shouldRunWorkerOnDemand
);
const shouldUseQueue = queueEnabled;

const skipVersionCheck = parseBool(
  process.env.BULLMQ_SKIP_VERSION_CHECK,
  process.env.NODE_ENV === "production"
);

let videoQueue = null;

export const getVideoQueue = () => {
  if (!shouldUseQueue) {
    return null;
  }

  const redisConnection = getRedisConnection();

  if (!redisConnection) {
    return null;
  }

  if (!videoQueue) {
    videoQueue = new Queue("video-processing", {
      connection: redisConnection,
      skipVersionCheck,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }

  return videoQueue;
};

export const closeVideoQueue = async () => {
  if (!videoQueue) {
    return;
  }

  const queueToClose = videoQueue;
  videoQueue = null;

  await queueToClose.close();
  console.log("Video queue closed.");
};
