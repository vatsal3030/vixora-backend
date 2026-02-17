/*
  Warnings:

  - You are about to alter the column `duration` on the `HLSSegment` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(65,30)`.
  - A unique constraint covering the columns `[idempotencyKey]` on the table `VideoProcessingJob` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "BackgroundJob" ADD COLUMN     "correlationId" TEXT;

-- AlterTable
ALTER TABLE "HLSPlaylist" ADD COLUMN     "cdnVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "isMaster" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "HLSSegment" ALTER COLUMN "duration" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "UploadSession" ADD COLUMN     "totalSize" BIGINT,
ADD COLUMN     "uploadedSize" BIGINT;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "isHlsReady" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "masterPlaylistUrl" TEXT,
ADD COLUMN     "processingLockedAt" TIMESTAMP(3),
ADD COLUMN     "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "processingWorkerId" TEXT,
ADD COLUMN     "storageProvider" TEXT,
ADD COLUMN     "storageRegion" TEXT;

-- AlterTable
ALTER TABLE "VideoProcessingJob" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "jobType" "JobType" NOT NULL DEFAULT 'VIDEO_PROCESSING';

-- AlterTable
ALTER TABLE "VideoRendition" ADD COLUMN     "codec" TEXT,
ADD COLUMN     "fps" DOUBLE PRECISION;

-- CreateIndex
CREATE UNIQUE INDEX "VideoProcessingJob_idempotencyKey_key" ON "VideoProcessingJob"("idempotencyKey");
