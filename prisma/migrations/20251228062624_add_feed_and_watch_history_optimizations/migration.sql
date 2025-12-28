/*
  Warnings:

  - You are about to drop the `_WatchHistory` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_WatchHistory" DROP CONSTRAINT "_WatchHistory_A_fkey";

-- DropForeignKey
ALTER TABLE "_WatchHistory" DROP CONSTRAINT "_WatchHistory_B_fkey";

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "engagementScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "popularityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "shareCount" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "_WatchHistory";

-- CreateTable
CREATE TABLE "WatchHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "watchCount" INTEGER NOT NULL DEFAULT 1,
    "lastWatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatchHistory_userId_idx" ON "WatchHistory"("userId");

-- CreateIndex
CREATE INDEX "WatchHistory_videoId_idx" ON "WatchHistory"("videoId");

-- CreateIndex
CREATE INDEX "WatchHistory_lastWatchedAt_idx" ON "WatchHistory"("lastWatchedAt");

-- CreateIndex
CREATE INDEX "WatchHistory_userId_updatedAt_idx" ON "WatchHistory"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchHistory_userId_videoId_key" ON "WatchHistory"("userId", "videoId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Subscription_channelId_idx" ON "Subscription"("channelId");

-- CreateIndex
CREATE INDEX "Tag_name_idx" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Video_isPublished_idx" ON "Video"("isPublished");

-- CreateIndex
CREATE INDEX "Video_isPublished_createdAt_idx" ON "Video"("isPublished", "createdAt");

-- CreateIndex
CREATE INDEX "Video_views_idx" ON "Video"("views");

-- CreateIndex
CREATE INDEX "Video_popularityScore_idx" ON "Video"("popularityScore");

-- CreateIndex
CREATE INDEX "Video_updatedAt_idx" ON "Video"("updatedAt");

-- AddForeignKey
ALTER TABLE "WatchHistory" ADD CONSTRAINT "WatchHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchHistory" ADD CONSTRAINT "WatchHistory_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
