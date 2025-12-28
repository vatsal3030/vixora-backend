-- AlterTable
ALTER TABLE "User" ADD COLUMN     "channelBanner" TEXT,
ADD COLUMN     "channelCategory" TEXT,
ADD COLUMN     "channelDescription" TEXT,
ADD COLUMN     "channelLinks" JSONB;
