import prisma from "../db/prisma.js";
import { deleteVideoOnCloudinary, deleteImageOnCloudinary } from "../utils/cloudinary.js";

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

async function runNightlyCleanup() {
    console.log("🌙 Nightly cleanup started");

    const expiredVideos = await prisma.video.findMany({
        where: {
            isDeleted: true,
            deletedAt: {
                lt: new Date(Date.now() - SEVEN_DAYS),
            },
        },
        select: {
            id: true,
            videoPublicId: true,
            thumbnailPublicId: true,
        },
        take: 20, // 🔐 safety batch
    });

    console.log(`Found ${expiredVideos.length} expired videos`);

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
        } catch (err) {
            console.error(`❌ Failed to delete video ${video.id}`, err);
        }
    }

    console.log("🌙 Nightly cleanup finished");
}

runNightlyCleanup()
    .catch((err) => {
        console.error("❌ Nightly job failed", err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        process.exit(0);
    });
