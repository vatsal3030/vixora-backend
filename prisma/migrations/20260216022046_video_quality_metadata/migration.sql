-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "availableQualities" TEXT[] DEFAULT ARRAY['MAX', '1080p', '720p', '480p']::TEXT[];
