import { Worker } from "bullmq";
import { redisConnection } from "../queue/redis.connection.js";
import prisma from "../db/prisma.js";
import { generateVideoThumbnail } from "../utils/cloudinaryThumbnail.js";


/* ---------------- CANCEL CHECK ---------------- */
const checkIfCancelled = async (videoId) => {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { processingStatus: true },
  });

  if (!video) throw new Error("VIDEO_NOT_FOUND");

  if (video.processingStatus === "CANCELLED") {
    throw new Error("PROCESSING_CANCELLED");
  }
};

const worker = new Worker(
  "video-processing",
  async (job) => {
    const { videoId } = job.data;

    console.log("🎬 Background processing started:", videoId);

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

      /* Analytics Snapshot */

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
        select: { thumbnail: true, videoFile: true }
      });

      if (!video) {
        throw new Error("VIDEO_DELETED_DURING_PROCESSING");
      }

      if (!video.thumbnail && video.videoFile) {
        const autoThumbnail = generateVideoThumbnail(video.videoFile);

        await prisma.video.update({
          where: { id: videoId },
          data: { thumbnail: autoThumbnail }
        });
      }

      /* Complete */
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

      console.log("✅ Background processing completed:", videoId);

      return true;

    } catch (error) {
      
      if (error.message === "VIDEO_DELETED_DURING_PROCESSING") {
        console.log("🛑 Video deleted during processing:", videoId);
        return;
      }

      if (error.message === "PROCESSING_CANCELLED") {
        console.log("🛑 Processing cancelled:", videoId);
        return;
      }

      console.error("❌ Worker error:", error);

      await prisma.video.update({
        where: { id: videoId },
        data: {
          processingStatus: "FAILED",
          processingError: error.message,
        },
      });

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);

console.log("🚀 Cloudinary Background Worker started");
