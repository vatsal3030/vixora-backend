import { videoQueue } from "./video.queue.js";

export const enqueueVideoProcessing = async ({
  videoId,
  userId,
  videoUrl,
}) => {
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
