

export const updateVideoScore =  async (videoId) => {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: {
      likes: true,
      comments: true,
      watchHistory: true
    }
  });

  const score =
    video.views * 0.3 +
    video.likes.length * 0.4 +
    video.comments.length * 0.2 +
    video.watchHistory.length * 0.1;

  await prisma.video.update({
    where: { id: videoId },
    data: {
      popularityScore: score,
      engagementScore: score / 10
    }
  });
};
