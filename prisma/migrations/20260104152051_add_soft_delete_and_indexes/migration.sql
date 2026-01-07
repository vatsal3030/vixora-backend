-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tweet" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Playlist_isDeleted_idx" ON "Playlist"("isDeleted");

-- CreateIndex
CREATE INDEX "Playlist_isDeleted_ownerId_createdAt_idx" ON "Playlist"("isDeleted", "ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Tweet_isDeleted_ownerId_createdAt_idx" ON "Tweet"("isDeleted", "ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "User_isDeleted_idx" ON "User"("isDeleted");

-- CreateIndex
CREATE INDEX "Video_isDeleted_idx" ON "Video"("isDeleted");

-- CreateIndex
CREATE INDEX "Video_isDeleted_isPublished_createdAt_idx" ON "Video"("isDeleted", "isPublished", "createdAt");

-- CreateIndex
CREATE INDEX "Video_isDeleted_ownerId_createdAt_idx" ON "Video"("isDeleted", "ownerId", "createdAt");
