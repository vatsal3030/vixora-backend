import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { buildVideoStreamingPayload } from "../utils/videoQuality.js";

export const getVideoStreamingData = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  const { quality } = req.query;
  const viewerId = req.user?.id || null;

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      thumbnail: true,
      duration: true,
      ownerId: true,
      isPublished: true,
      isDeleted: true,
      processingStatus: true,
      isHlsReady: true,
      videoFile: true,
      playbackUrl: true,
      masterPlaylistUrl: true,
      availableQualities: true,
    },
  });

  if (!video) throw new ApiError(404, "Video not found");

  const isOwner = Boolean(viewerId && viewerId === video.ownerId);

  if (
    video.isDeleted ||
    video.processingStatus !== "COMPLETED" ||
    !video.isHlsReady
  ) {
    throw new ApiError(404, "Video not ready for streaming");
  }

  if (!video.isPublished && !isOwner) {
    throw new ApiError(403, "This video is not published");
  }

  const streaming = buildVideoStreamingPayload({
    sourceUrl: video.videoFile,
    playbackUrl: video.masterPlaylistUrl || video.playbackUrl,
    availableQualities: video.availableQualities,
    requestedQuality: quality,
  });

  return res.json(
    new ApiResponse(200, {
      videoId: video.id,
      playbackUrl: streaming.selectedPlaybackUrl,
      masterPlaylistUrl: streaming.masterPlaylistUrl,
      selectedQuality: streaming.selectedQuality,
      qualities: streaming.availableQualities,
      qualityUrls: streaming.qualityUrls,
      thumbnail: video.thumbnail,
      title: video.title,
      duration: video.duration,
      viewerContext: {
        isOwner,
      },
    })
  );
});
