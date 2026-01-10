-- AlterTable
ALTER TABLE "PlaylistVideo" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "PlaylistVideo_playlistId_createdAt_idx" ON "PlaylistVideo"("playlistId", "createdAt");
