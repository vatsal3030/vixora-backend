-- CreateEnum
CREATE TYPE "NotificationLevel" AS ENUM ('ALL', 'PERSONALIZED', 'NONE');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "notificationLevel" "NotificationLevel" NOT NULL DEFAULT 'PERSONALIZED';
