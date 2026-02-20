-- AlterTable
ALTER TABLE "VideoTranscript" ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "segments" JSONB,
ADD COLUMN     "source" TEXT DEFAULT 'MANUAL',
ADD COLUMN     "wordCount" INTEGER;
