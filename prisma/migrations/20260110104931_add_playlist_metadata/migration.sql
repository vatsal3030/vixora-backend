-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "lastVideoAddedAt" TIMESTAMP(3),
ADD COLUMN     "totalDuration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "videoCount" INTEGER NOT NULL DEFAULT 0;
