/*
  Warnings:

  - You are about to drop the column `pendingEmailOtpExpiry` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "pendingEmailOtpExpiry",
ADD COLUMN     "pendingEmailOtpExpiresAt" TIMESTAMP(3);
