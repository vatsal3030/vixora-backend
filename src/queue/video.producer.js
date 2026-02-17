import { videoQueue } from "./video.queue.js";

export const enqueueVideoProcessing = async ({
  videoId,
  userId,
  videoUrl,
}) => {
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
