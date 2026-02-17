import { QueueEvents } from "bullmq";
import { redisConnection } from "./redis.connection.js";

export const videoQueueEvents = new QueueEvents("video-processing", {
  connection: redisConnection,
});

videoQueueEvents.on("completed", ({ jobId }) => {
  console.log("✅ Job completed:", jobId);
});

videoQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error("❌ Job failed:", jobId, failedReason);
});

videoQueueEvents.on("waiting", ({ jobId }) => {
  console.log("⏳ Job waiting:", jobId);
});
