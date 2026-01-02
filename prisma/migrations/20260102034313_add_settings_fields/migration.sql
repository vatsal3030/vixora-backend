-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "hideShorts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "personalizeRecommendations" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showChannelName" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showProgressBar" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showTrending" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showVideoDuration" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showViewCount" BOOLEAN NOT NULL DEFAULT true;
