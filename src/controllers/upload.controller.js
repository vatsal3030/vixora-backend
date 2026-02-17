import prisma from "../db/prisma.js"
import { enqueueVideoProcessing } from "../queue/video.producer.js";
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import crypto from "crypto";
import { verifyCloudinaryAssetOwnership } from "../utils/verifyCloudinaryAsset.js";
import { generateVideoThumbnail } from "../utils/cloudinaryThumbnail.js";

const processVideoWithoutQueue = async (videoId) => {
    try {
        await prisma.video.update({
            where: { id: videoId },
            data: {
                processingStatus: "PROCESSING",
                processingStartedAt: new Date(),
                processingProgress: 20,
                processingStep: "FALLBACK_PROCESSING",
            },
        });

        await prisma.videoAnalyticsSnapshot.create({
            data: {
                videoId,
                views: 0,
                likes: 0,
                comments: 0,
                shares: 0,
                watchTimeSeconds: 0,
                snapshotDate: new Date(),
            },
        }).catch(() => null);

        const video = await prisma.video.findUnique({
            where: { id: videoId },
            select: { thumbnail: true, videoFile: true },
        });

        if (!video) {
            throw new Error("Video not found during fallback processing");
        }

        if (!video.thumbnail && video.videoFile) {
            const autoThumbnail = generateVideoThumbnail(video.videoFile);
            if (autoThumbnail) {
                await prisma.video.update({
                    where: { id: videoId },
                    data: { thumbnail: autoThumbnail },
                });
            }
        }

        await prisma.video.update({
            where: { id: videoId },
            data: {
                processingStatus: "COMPLETED",
                processingCompletedAt: new Date(),
                processingProgress: 100,
                processingStep: "DONE",
                isPublished: true,
                isHlsReady: true,
            },
        });
    } catch (error) {
        console.error("Fallback video processing failed:", error?.message || error);
        await prisma.video.update({
            where: { id: videoId },
            data: {
                processingStatus: "FAILED",
                processingError: error?.message || "Fallback processing failed",
            },
        }).catch(() => null);
    }
};

/*
CREATE UPLOAD SESSION
*/
export const createUploadSession = asyncHandler(async (req, res) => {
    const { fileName, fileSize, mimeType } = req.body;

    if (!fileName || fileSize === undefined || !mimeType) {
        throw new ApiError(400, "fileName, fileSize, mimeType required");
    }

    const numericFileSize = Number(fileSize);

    if (
        !Number.isFinite(numericFileSize) ||
        numericFileSize <= 0 ||
        numericFileSize > 5 * 1024 * 1024 * 1024 // 5GB cap
    ) {
        throw new ApiError(400, "Invalid file size");
    }

    const session = await prisma.uploadSession.create({
        data: {
            userId: req.user.id,
            status: "INITIATED",
            totalSize: numericFileSize,
        },
    });

    const safeSession = {
        ...session,
        totalSize: session.totalSize?.toString(),
        uploadedSize: session.uploadedSize?.toString(),
    };

    return res.status(201).json(
        new ApiResponse(201, safeSession, "Upload session created")
    );

});

/*
CANCEL UPLOAD SESSION
*/
export const cancelUploadSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const session = await prisma.uploadSession.findUnique({
        where: { id: sessionId },
    });

    if (!session) throw new ApiError(404, "Session not found");

    if (session.userId !== req.user.id) {
        throw new ApiError(403, "Not allowed");
    }

    await prisma.uploadSession.update({
        where: { id: sessionId },
        data: {
            status: "FAILED",
            cancelledAt: new Date(),
        },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Upload cancelled")
    );
});

/*
GET CLOUDINARY SIGNATURE
*/
export const getUploadSignature = asyncHandler(async (req, res) => {
    const { resourceType = "video" } = req.query;

    if (!req.user.emailVerified) {
        throw new ApiError(403, "Verify email first");
    }

    const timestamp = Math.floor(Date.now() / 1000);

    const folderMap = {
        video: `videos/${req.user.id}`,
        thumbnail: `thumbnails/${req.user.id}`,
        avatar: `avatars/${req.user.id}`,
        post: `posts/${req.user.id}`,
    };

    const folder = folderMap[resourceType] || `misc/${req.user.id}`;

    const publicId = `${folder}/${crypto.randomUUID()}`;

    const signature = crypto
        .createHash("sha1")
        .update(
            `public_id=${publicId}&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`
        )
        .digest("hex");

    return res.status(200).json(
        new ApiResponse(200, {
            timestamp,
            signature,
            publicId,
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            resourceType,
        })
    );
});


/*
UPDATE UPLOAD PROGRESS
*/
export const updateUploadProgress = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { uploadedBytes } = req.body;
    const PROGRESS_OVERHEAD_TOLERANCE_BYTES = 5n * 1024n * 1024n; // 5MB

    if (uploadedBytes === undefined || uploadedBytes === null) {
        throw new ApiError(400, "uploadedBytes required");
    }

    let uploadedBigInt;
    try {
        uploadedBigInt = BigInt(uploadedBytes);
    } catch {
        throw new ApiError(400, "Invalid uploadedBytes value");
    }

    if (uploadedBigInt < 0n) {
        throw new ApiError(400, "uploadedBytes cannot be negative");
    }

    const session = await prisma.uploadSession.findUnique({
        where: { id: sessionId },
    });

    if (!session) throw new ApiError(404, "Session not found");

    if (session.userId !== req.user.id) {
        throw new ApiError(403, "Not allowed");
    }

    if (
        session.totalSize &&
        uploadedBigInt > session.totalSize + PROGRESS_OVERHEAD_TOLERANCE_BYTES
    ) {
        throw new ApiError(400, "uploadedBytes exceeds total size");
    }

    // Cloudinary/form-data progress can slightly exceed raw file size due to multipart overhead.
    // Clamp to known total size, and never regress if events arrive out of order.
    const clampedUploaded =
        session.totalSize && uploadedBigInt > session.totalSize
            ? session.totalSize
            : uploadedBigInt;

    const previousUploaded = session.uploadedSize ?? 0n;
    const normalizedUploaded =
        clampedUploaded < previousUploaded ? previousUploaded : clampedUploaded;

    const updated = await prisma.uploadSession.update({
        where: { id: sessionId },
        data: {
            uploadedSize: normalizedUploaded,
            status: "UPLOADING",
        },
    });

    let percent = 0;
    if (session.totalSize && session.totalSize > 0n) {
        percent = Number(normalizedUploaded) / Number(session.totalSize) * 100;
    }

    return res.json(
        new ApiResponse(200, {
            ...updated,
            totalSize: updated.totalSize?.toString(),
            uploadedSize: updated.uploadedSize?.toString(),
            progressPercent: Math.min(percent, 100)
        })
    );
});


/*
FINALIZE UPLOAD → CREATE VIDEO + START PROCESSING
*/
export const finalizeUpload = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const {
        title,
        description,
        publicId,
        thumbnailPublicId,
        duration,
        width,
        height,
        tags = [],
        isShort = false
    } = req.body;

    if (
        !title ||
        !description ||
        !publicId ||
        !thumbnailPublicId
    ) {
        throw new ApiError(400, "Missing required fields");
    }

    const session = await prisma.uploadSession.findUnique({
        where: { id: sessionId },
    });

    if (!session) throw new ApiError(404, "Session not found");

    if (!session.userId || session.userId !== req.user.id) {
        throw new ApiError(403, "Not allowed");
    }

    if (session.status === "FAILED") throw new ApiError(400, "Upload cancelled");

    if (session.status === "COMPLETED") throw new ApiError(400, "Already finalized");

    if (!["INITIATED", "UPLOADING"].includes(session.status)) {
        throw new ApiError(400, "Invalid upload state");
    }

    let normalizedIsShort = false;
    if (typeof isShort === "boolean") {
        normalizedIsShort = isShort;
    } else if (typeof isShort === "string") {
        const lowered = isShort.trim().toLowerCase();
        if (lowered === "true") normalizedIsShort = true;
        else if (lowered === "false") normalizedIsShort = false;
        else throw new ApiError(400, "isShort must be true or false");
    } else if (isShort !== undefined && isShort !== null) {
        throw new ApiError(400, "isShort must be boolean");
    }



    /* ---------- CLOUDINARY OWNERSHIP VERIFY ---------- */

    const videoFolder = `videos/${req.user.id}`;
    const thumbnailFolder = `thumbnails/${req.user.id}`;

    const videoResource = await verifyCloudinaryAssetOwnership(
        publicId,
        videoFolder,
        { resourceTypes: ["video"] }
    );
    const thumbResource = await verifyCloudinaryAssetOwnership(
        thumbnailPublicId,
        thumbnailFolder,
        { resourceTypes: ["image"] }
    );

    // ✅ TRUST CLOUDINARY RESPONSE ONLY
    const safeVideoUrl = videoResource.secure_url;
    const safeThumbUrl = thumbResource.secure_url;


    /* ---------- SAFE TAG PARSE ---------- */

    const tagArray = Array.isArray(tags)
        ? tags.map(t => t.toLowerCase().trim())
        : [];

    const video = await prisma.$transaction(async (tx) => {

        if (tagArray.length > 0) {
            await tx.tag.createMany({
                data: tagArray.map(name => ({ name })),
                skipDuplicates: true
            });
        }

        const tagRecords = tagArray.length > 0
            ? await tx.tag.findMany({
                where: { name: { in: tagArray } },
                select: { id: true }
            })
            : [];

        /* ---------- SAFE PLAYBACK URL ---------- */

        const cloudinaryPlaybackUrl =
            safeVideoUrl?.includes("/upload/")
                ? safeVideoUrl.replace("/upload/", "/upload/sp_auto/")
                : safeVideoUrl;

        const newVideo = await tx.video.create({
            data: {
                title,
                description,
                duration: duration ? Math.round(duration) : 0,
                aspectRatio: width && height ? `${width}:${height}` : null,

                videoFile: safeVideoUrl,
                playbackUrl: cloudinaryPlaybackUrl,

                videoPublicId: publicId,

                thumbnail: safeThumbUrl,
                thumbnailPublicId: thumbnailPublicId,

                ownerId: req.user.id,
                isShort: normalizedIsShort,

                isPublished: false,
                processingStatus: "PENDING",
                isHlsReady: false,
            }
        });

        if (tagRecords.length > 0) {
            await tx.videoTag.createMany({
                data: tagRecords.map(tag => ({
                    videoId: newVideo.id,
                    tagId: tag.id
                }))
            });
        }

        return newVideo;
    });

    /* ---------- MARK SESSION COMPLETE ---------- */

    await prisma.uploadSession.update({
        where: { id: sessionId },
        data: {
            status: "COMPLETED",
            videoId: video.id
        }
    });

    /* ---------- START BACKGROUND PROCESS ---------- */

    let queued = null;
    try {
        queued = await enqueueVideoProcessing({
            videoId: video.id,
            userId: req.user.id,
            videoUrl: safeVideoUrl
        });
    } catch (error) {
        console.error("Queue enqueue failed. Falling back to direct processing:", error?.message || error);
    }

    if (!queued) {
        processVideoWithoutQueue(video.id);
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            video,
            "Upload finalized. Processing started."
        )
    );
});

