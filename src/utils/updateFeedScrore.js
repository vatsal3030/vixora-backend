import prisma from "../db/prisma.js";

export const updateVideoScore = async (videoId) => {
  if (!videoId) return;

  const [video, likesCount, commentsCount, watchCount] = await Promise.all([
    prisma.video.findUnique({
      where: { id: videoId },
      select: { views: true },
    }),
    prisma.like.count({ where: { videoId } }),
    prisma.comment.count({ where: { videoId, isDeleted: false } }),
    prisma.watchHistory.count({ where: { videoId } }),
  ]);

  if (!video) return;

  const score =
    video.views * 0.3 +
    likesCount * 0.4 +
    commentsCount * 0.2 +
    watchCount * 0.1;

  await prisma.video.update({
    where: { id: videoId },
    data: {
      popularityScore: score,
      engagementScore: score / 10,
    },
  });
};
