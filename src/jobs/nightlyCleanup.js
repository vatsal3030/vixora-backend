import prisma from "../db/prisma.js";
import { deleteVideoOnCloudinary, deleteImageOnCloudinary } from "../utils/cloudinary.js";

// 🌙 Configurable batch limits
const SEVEN_DAYS = SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = parseInt(process.env.NIGHT_BATCH_LIMIT || "20");

// Pre-calculate expiration date
const expirationDate = new Date(Date.now() - SEVEN_DAYS);

async function runNightlyCleanup() {

    console.log("🌙 Nightly cleanup started");

    // 🔍 Fetch expired videos safely
    const expiredVideos = await prisma.video.findMany({
        where: {
            isDeleted: true,
            deletedAt: {
                lt: expirationDate,
            },
        },
        select: {
            id: true,
            videoPublicId: true,
            thumbnailPublicId: true,
        },
        take: BATCH_LIMIT, // 🔐 safe batch
    });

    console.log(`📦 Found ${expiredVideos.length} expired videos`);

    for (const video of expiredVideos) {

        try {

            // 🗑️ Delete video asset
            if (video.videoPublicId) {
                await deleteVideoOnCloudinary(video.videoPublicId);
            }

            // 🗑️ Delete thumbnail
            if (video.thumbnailPublicId) {
                await deleteImageOnCloudinary(video.thumbnailPublicId);
            }

            // 🔥 Remove from DB permanently
            await prisma.video.delete({
                where: { id: video.id },
            });

            console.log(`✅ Deleted video ${video.id}`);

        } catch (error) {
            console.error(`❌ Failed to delete video ${video.id}:`, error.message);
        }
    }

    console.log("🌙 Nightly cleanup finished");
}

// RUN IT
runNightlyCleanup()
    .catch((err) => {
        console.error("❌ Nightly job failed:", err.message);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        process.exit(0);
    });
