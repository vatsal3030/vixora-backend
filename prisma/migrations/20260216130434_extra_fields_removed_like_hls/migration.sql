/*
  Warnings:

  - You are about to drop the `HLSPlaylist` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HLSSegment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VideoRendition` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "HLSPlaylist" DROP CONSTRAINT "HLSPlaylist_renditionId_fkey";

-- DropForeignKey
ALTER TABLE "HLSPlaylist" DROP CONSTRAINT "HLSPlaylist_videoId_fkey";

-- DropForeignKey
ALTER TABLE "HLSSegment" DROP CONSTRAINT "HLSSegment_playlistId_fkey";

-- DropForeignKey
ALTER TABLE "VideoRendition" DROP CONSTRAINT "VideoRendition_jobId_fkey";

-- DropForeignKey
ALTER TABLE "VideoRendition" DROP CONSTRAINT "VideoRendition_videoId_fkey";

-- DropTable
DROP TABLE "HLSPlaylist";

-- DropTable
DROP TABLE "HLSSegment";

-- DropTable
DROP TABLE "VideoRendition";
