import prisma from "../db/prisma.js";
import { deleteVideoOnCloudinary, deleteImageOnCloudinary } from "../utils/cloudinary.js";

const SEVEN_DAYS  = 7 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = parseInt(process.env.NIGHT_BATCH_LIMIT || "20");

async function runNightlyCleanup() {

    console.log("🌙 Nightly cleanup started");

    const expirationDate = new Date(Date.now() - SEVEN_DAYS);

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
        take: BATCH_LIMIT,
    });

    console.log(`📦 Found ${expiredVideos.length} expired videos`);

    for (const video of expiredVideos) {
        try {

            if (video.videoPublicId) {
                await deleteVideoOnCloudinary(video.videoPublicId);
            }

            if (video.thumbnailPublicId) {
                await deleteImageOnCloudinary(video.thumbnailPublicId);
            }

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

export default runNightlyCleanup;   // ✅ ONLY EXPORT
