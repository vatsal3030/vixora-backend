-- AlterEnum
ALTER TYPE "ProcessingStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "UploadSession" ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "processingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "processingProgress" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "processingStartedAt" TIMESTAMP(3),
ADD COLUMN     "processingStep" TEXT;
