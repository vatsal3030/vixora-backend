import { Queue } from "bullmq";
import { redisConnection } from "./redis.connection.js";

export const videoQueue = redisConnection
  ? new Queue("video-processing", {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    })
  : null;
