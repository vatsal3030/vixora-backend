import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

export const getVideoStreamingData = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  const video = await prisma.video.findUnique({
    where: { id: videoId }
  });

  if (!video) throw new ApiError(404, "Video not found");

  return res.json(new ApiResponse(200, {
    videoId: video.id,
    playbackUrl: video.playbackUrl, // ✅ USE DB VALUE
    qualities: video.availableQualities || ["MAX","1080p","720p","480p"],
    thumbnail: video.thumbnail,
    title: video.title,
    duration: video.duration
  }));
});

