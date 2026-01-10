import prisma from "../db/prisma.js";

export const getOrCreateWatchLater = async (userId) => {
  const playlist = await prisma.playlist.findFirst({
    where: {
      ownerId: userId,
      name: "Watch Later",
      isDeleted: false,
    },
    select: { id: true },
  });

  if (playlist) return playlist.id;

  const created = await prisma.playlist.create({
    data: {
      name: "Watch Later",
      description: "Videos saved to watch later",
      isPublic: false, // 🔒 ALWAYS PRIVATE
      ownerId: userId,
    },
    select: { id: true },
  });

  return created.id;
};
