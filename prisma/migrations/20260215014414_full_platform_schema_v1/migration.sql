-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoQuality" AS ENUM ('P1080', 'P720', 'P480', 'P360');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('VIDEO_PROCESSING', 'AI_SUMMARY', 'AI_CHAT', 'EMAIL', 'NOTIFICATION', 'FEED_RECOMPUTE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('INITIATED', 'UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AIRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('VIDEO_VIEW', 'VIDEO_COMPLETE', 'VIDEO_LIKE', 'VIDEO_SHARE', 'VIDEO_COMMENT', 'SEARCH', 'SUBSCRIBE', 'UNSUBSCRIBE', 'NOT_INTERESTED', 'REPORT', 'LOGIN', 'LOGOUT');

-- CreateEnum
CREATE TYPE "EventEntityType" AS ENUM ('VIDEO', 'USER', 'COMMENT', 'PLAYLIST', 'CHANNEL');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('VIDEO', 'COMMENT', 'USER', 'CHANNEL');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'REVIEWED', 'REJECTED', 'ACTION_TAKEN');

-- CreateTable
CREATE TABLE "VideoProcessingJob" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoRendition" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "quality" "VideoQuality" NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bitrate" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoRendition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HLSPlaylist" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "renditionId" TEXT NOT NULL,
    "playlistUrl" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HLSPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HLSSegment" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "segmentUrl" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "sequence" INTEGER NOT NULL,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HLSSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT,
    "status" "UploadStatus" NOT NULL DEFAULT 'INITIATED',
    "totalChunks" INTEGER,
    "uploadedChunks" INTEGER NOT NULL DEFAULT 0,
    "uploadUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "views" INTEGER NOT NULL,
    "likes" INTEGER NOT NULL,
    "comments" INTEGER NOT NULL,
    "shares" INTEGER NOT NULL,
    "watchTimeSeconds" INTEGER NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedTrainingSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "label" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedTrainingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercentage" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFeatureOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL,

    CONSTRAINT "UserFeatureOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoTranscript" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIChatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "videoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "AIRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tokensUsed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "eventType" "EventType" NOT NULL,
    "entityType" "EventEntityType" NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoProcessingJob_videoId_idx" ON "VideoProcessingJob"("videoId");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_status_idx" ON "VideoProcessingJob"("status");

-- CreateIndex
CREATE INDEX "VideoRendition_videoId_idx" ON "VideoRendition"("videoId");

-- CreateIndex
CREATE INDEX "VideoRendition_quality_idx" ON "VideoRendition"("quality");

-- CreateIndex
CREATE INDEX "VideoRendition_videoId_quality_idx" ON "VideoRendition"("videoId", "quality");

-- CreateIndex
CREATE INDEX "BackgroundJob_jobType_idx" ON "BackgroundJob"("jobType");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_idx" ON "BackgroundJob"("status");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_scheduledFor_idx" ON "BackgroundJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "HLSPlaylist_videoId_idx" ON "HLSPlaylist"("videoId");

-- CreateIndex
CREATE INDEX "HLSPlaylist_renditionId_idx" ON "HLSPlaylist"("renditionId");

-- CreateIndex
CREATE UNIQUE INDEX "HLSPlaylist_videoId_renditionId_version_key" ON "HLSPlaylist"("videoId", "renditionId", "version");

-- CreateIndex
CREATE INDEX "HLSSegment_playlistId_sequence_idx" ON "HLSSegment"("playlistId", "sequence");

-- CreateIndex
CREATE INDEX "UploadSession_userId_idx" ON "UploadSession"("userId");

-- CreateIndex
CREATE INDEX "UploadSession_status_idx" ON "UploadSession"("status");

-- CreateIndex
CREATE INDEX "UploadSession_videoId_idx" ON "UploadSession"("videoId");

-- CreateIndex
CREATE INDEX "SearchHistory_query_idx" ON "SearchHistory"("query");

-- CreateIndex
CREATE INDEX "SearchHistory_userId_idx" ON "SearchHistory"("userId");

-- CreateIndex
CREATE INDEX "VideoAnalyticsSnapshot_videoId_snapshotDate_idx" ON "VideoAnalyticsSnapshot"("videoId", "snapshotDate");

-- CreateIndex
CREATE INDEX "FeedTrainingSnapshot_userId_idx" ON "FeedTrainingSnapshot"("userId");

-- CreateIndex
CREATE INDEX "FeedTrainingSnapshot_videoId_idx" ON "FeedTrainingSnapshot"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UserFeatureOverride_userId_featureId_key" ON "UserFeatureOverride"("userId", "featureId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoTranscript_videoId_key" ON "VideoTranscript"("videoId");

-- CreateIndex
CREATE INDEX "AIChatSession_userId_idx" ON "AIChatSession"("userId");

-- CreateIndex
CREATE INDEX "AIChatSession_videoId_idx" ON "AIChatSession"("videoId");

-- CreateIndex
CREATE INDEX "AIChatSession_createdAt_idx" ON "AIChatSession"("createdAt");

-- CreateIndex
CREATE INDEX "AIChatMessage_sessionId_idx" ON "AIChatMessage"("sessionId");

-- CreateIndex
CREATE INDEX "AIChatMessage_createdAt_idx" ON "AIChatMessage"("createdAt");

-- CreateIndex
CREATE INDEX "UserEvent_userId_idx" ON "UserEvent"("userId");

-- CreateIndex
CREATE INDEX "UserEvent_eventType_idx" ON "UserEvent"("eventType");

-- CreateIndex
CREATE INDEX "UserEvent_entityType_entityId_idx" ON "UserEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "UserEvent_createdAt_idx" ON "UserEvent"("createdAt");

-- CreateIndex
CREATE INDEX "UserEvent_userId_createdAt_idx" ON "UserEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserEvent_eventType_createdAt_idx" ON "UserEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "Report_reporterId_idx" ON "Report"("reporterId");

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");

-- CreateIndex
CREATE INDEX "FeedScore_userId_videoId_idx" ON "FeedScore"("userId", "videoId");

-- CreateIndex
CREATE INDEX "FeedScore_score_createdAt_idx" ON "FeedScore"("score", "createdAt");

-- CreateIndex
CREATE INDEX "Video_ownerId_createdAt_idx" ON "Video"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Video_isPublished_popularityScore_idx" ON "Video"("isPublished", "popularityScore");

-- CreateIndex
CREATE INDEX "WatchHistory_userId_lastWatchedAt_idx" ON "WatchHistory"("userId", "lastWatchedAt");

-- AddForeignKey
ALTER TABLE "VideoProcessingJob" ADD CONSTRAINT "VideoProcessingJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoRendition" ADD CONSTRAINT "VideoRendition_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoRendition" ADD CONSTRAINT "VideoRendition_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "VideoProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HLSPlaylist" ADD CONSTRAINT "HLSPlaylist_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HLSPlaylist" ADD CONSTRAINT "HLSPlaylist_renditionId_fkey" FOREIGN KEY ("renditionId") REFERENCES "VideoRendition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HLSSegment" ADD CONSTRAINT "HLSSegment_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "HLSPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchHistory" ADD CONSTRAINT "SearchHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnalyticsSnapshot" ADD CONSTRAINT "VideoAnalyticsSnapshot_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedTrainingSnapshot" ADD CONSTRAINT "FeedTrainingSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedTrainingSnapshot" ADD CONSTRAINT "FeedTrainingSnapshot_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFeatureOverride" ADD CONSTRAINT "UserFeatureOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFeatureOverride" ADD CONSTRAINT "UserFeatureOverride_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "FeatureFlag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoTranscript" ADD CONSTRAINT "VideoTranscript_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIChatSession" ADD CONSTRAINT "AIChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIChatSession" ADD CONSTRAINT "AIChatSession_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIChatMessage" ADD CONSTRAINT "AIChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AIChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEvent" ADD CONSTRAINT "UserEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
