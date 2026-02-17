import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { videoQueue } from "../queue/video.queue.js";


export const getVideoProcessingStatus = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      processingStatus: true,
      processingProgress: true,
      processingStep: true,
      processingError: true,
      processingStartedAt: true,
      processingCompletedAt: true,
      isHlsReady: true,
      isPublished: true,
    },
  });

  if (!video) throw new ApiError(404, "Video not found");

  return res.status(200).json(
    new ApiResponse(200, video, "Processing status fetched")
  );
});


export const cancelVideoProcessing = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  const video = await prisma.video.findUnique({
    where: { id: videoId },
  });

  if (!video) throw new ApiError(404, "Video not found");

  if (video.ownerId !== req.user.id) {
    throw new ApiError(403, "Not allowed");
  }

  if (
    video.processingStatus !== "PENDING" &&
    video.processingStatus !== "PROCESSING"
  ) {
    throw new ApiError(400, "Video cannot be cancelled now");
  }

  // 🧠 Remove job from queue
  if (videoQueue) {
    const jobId = `video-${videoId}`;
    const job = await videoQueue.getJob(jobId);

    if (job) {
      const state = await job.getState();
      if (state !== "completed" && state !== "failed") {
        await job.remove();
      }
    }
  }

  // ✅ Update DB
  await prisma.video.update({
    where: { id: videoId },
    data: {
      processingStatus: "CANCELLED",
      isPublished: false,
    },
  });

  return res.status(200).json(
    new ApiResponse(200, {}, "Processing cancelled")
  );
});


