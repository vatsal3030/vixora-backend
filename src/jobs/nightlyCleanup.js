import prisma from "../db/prisma.js";
import {
  deleteVideoOnCloudinary,
  deleteImageOnCloudinary
} from "../utils/cloudinary.js";

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/* ---------- SAFE BATCH LIMIT ---------- */
const RAW_BATCH = Number(process.env.NIGHT_BATCH_LIMIT);
const BATCH_LIMIT =
  Number.isFinite(RAW_BATCH) && RAW_BATCH > 0 && RAW_BATCH <= 100
    ? RAW_BATCH
    : 20;

async function runNightlyCleanup() {

  console.log("🌙 Nightly cleanup started");

  const expirationDate = new Date(Date.now() - SEVEN_DAYS);

  const expiredVideos = await prisma.video.findMany({
    where: {
      isDeleted: true,
      deletedAt: { not: null, lt: expirationDate }
    },
    select: {
      id: true,
      videoPublicId: true,
      thumbnailPublicId: true,
    },
    take: BATCH_LIMIT,
  });

  console.log(`📦 Found ${expiredVideos.length} expired videos`);

  for (const video of expiredVideos) {

    try {

      /* ---------- STEP 1: DELETE DB FIRST (SOURCE OF TRUTH) ---------- */
      await prisma.video.delete({
        where: { id: video.id },
      });

      /* ---------- STEP 2: DELETE CLOUDINARY (BEST EFFORT) ---------- */

      if (video.videoPublicId) {
        try {
          await deleteVideoOnCloudinary(video.videoPublicId);
        } catch (err) {
          console.error(
            `⚠️ Cloudinary video delete failed for ${video.id}:`,
            err.message
          );
        }
      }

      if (video.thumbnailPublicId) {
        try {
          await deleteImageOnCloudinary(video.thumbnailPublicId);
        } catch (err) {
          console.error(
            `⚠️ Cloudinary thumbnail delete failed for ${video.id}:`,
            err.message
          );
        }
      }

      console.log(`✅ Deleted video ${video.id}`);

    } catch (error) {
      console.error(
        `❌ Failed to delete video ${video.id}:`,
        error.message
      );
    }
  }

  console.log("🌙 Nightly cleanup finished");
}

export default runNightlyCleanup;
