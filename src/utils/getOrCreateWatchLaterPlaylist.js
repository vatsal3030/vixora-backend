import prisma from "../db/prisma.js";

const WATCH_LATER_NAME = "Watch Later";

export const getOrCreateWatchLater = async (userId) => {
  const playlist = await prisma.playlist.findFirst({
    where: {
      ownerId: userId,
      name: {
        equals: WATCH_LATER_NAME,
        mode: "insensitive",
      },
      isDeleted: false,
    },
    select: { id: true },
  });

  if (playlist) return playlist.id;

  const created = await prisma.playlist.create({
    data: {
      name: WATCH_LATER_NAME,
      description: "Videos saved to watch later",
      isPublic: false,
      isSystem: true,
      ownerId: userId,
    },
    select: { id: true },
  });

  return created.id;
};

