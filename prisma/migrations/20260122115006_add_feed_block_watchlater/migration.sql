/*
  Warnings:

  - You are about to drop the column `channelCategory` on the `User` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `FeedScore` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "FeedScore" ADD COLUMN     "engagementScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "freshnessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "interestScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "socialScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "channelCategory";

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelCategory" (
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "ChannelCategory_pkey" PRIMARY KEY ("userId","categoryId")
);

-- CreateTable
CREATE TABLE "VideoCategory" (
    "videoId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "VideoCategory_pkey" PRIMARY KEY ("videoId","categoryId")
);

-- CreateTable
CREATE TABLE "ShareEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "videoId" TEXT NOT NULL,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotInterested" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotInterested_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_slug_idx" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "ChannelCategory_categoryId_idx" ON "ChannelCategory"("categoryId");

-- CreateIndex
CREATE INDEX "ChannelCategory_userId_idx" ON "ChannelCategory"("userId");

-- CreateIndex
CREATE INDEX "VideoCategory_categoryId_videoId_idx" ON "VideoCategory"("categoryId", "videoId");

-- CreateIndex
CREATE INDEX "VideoCategory_categoryId_idx" ON "VideoCategory"("categoryId");

-- CreateIndex
CREATE INDEX "VideoCategory_videoId_idx" ON "VideoCategory"("videoId");

-- CreateIndex
CREATE INDEX "NotInterested_userId_idx" ON "NotInterested"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotInterested_userId_videoId_key" ON "NotInterested"("userId", "videoId");

-- CreateIndex
CREATE INDEX "BlockedChannel_userId_idx" ON "BlockedChannel"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedChannel_userId_channelId_key" ON "BlockedChannel"("userId", "channelId");

-- CreateIndex
CREATE INDEX "FeedScore_userId_score_idx" ON "FeedScore"("userId", "score");

-- AddForeignKey
ALTER TABLE "ChannelCategory" ADD CONSTRAINT "ChannelCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelCategory" ADD CONSTRAINT "ChannelCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoCategory" ADD CONSTRAINT "VideoCategory_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoCategory" ADD CONSTRAINT "VideoCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
