-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pendingEmail" TEXT,
ADD COLUMN     "pendingEmailOtpExpiry" TIMESTAMP(3),
ADD COLUMN     "pendingEmailOtpHash" TEXT;
