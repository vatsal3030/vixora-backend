import prisma from "../db/prisma.js"
import { enqueueVideoProcessing } from "../queue/video.producer.js";
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import crypto from "crypto";
import { verifyCloudinaryAssetOwnership } from "../utils/verifyCloudinaryAsset.js";
import { generateVideoThumbnail } from "../utils/cloudinaryThumbnail.js";
import {
    buildVideoStreamingPayload,
    normalizeAvailableQualities,
} from "../utils/videoQuality.js";
import { parseTranscriptInput } from "../utils/transcript.js";
import {
    ChannelNotificationAudience,
    dispatchChannelActivityNotification,
} from "../services/notification.service.js";

const MAX_UPLOAD_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_UPLOAD_FILENAME_LENGTH = 255;
const MAX_UPLOAD_MIMETYPE_LENGTH = 100;
const MAX_VIDEO_TITLE_LENGTH = 120;
const MAX_VIDEO_DESCRIPTION_LENGTH = 5000;
const MAX_TRANSCRIPT_INPUT_CHARS = 120000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;
const DEFAULT_UPLOAD_SESSION_TTL_MINUTES = 120;
const ALLOWED_UPLOAD_SESSION_TYPES = new Set([
    "VIDEO",
    "IMAGE",
    "AVATAR",
    "COVER_IMAGE",
    "POST",
    "TWEET",
    "THUMBNAIL",
]);
const ALLOWED_SIGNATURE_RESOURCE_TYPES = new Set([
    "video",
    "thumbnail",
    "avatar",
    "post",
    "tweet",
    "cover",
    "coverimage",
]);
const ALLOWED_TRANSCRIPT_SOURCES = new Set(["MANUAL", "AUTO", "IMPORTED"]);

const normalizeText = (value) => String(value ?? "").trim();

const normalizeNumberOrNull = (value) => {
    if (value === undefined || value === null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const parsePositiveInt = (value, fallbackValue) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
};

const UPLOAD_SESSION_TTL_MINUTES = parsePositiveInt(
    process.env.UPLOAD_SESSION_TTL_MINUTES,
    DEFAULT_UPLOAD_SESSION_TTL_MINUTES
);
const UPLOAD_SESSION_TTL_MS = UPLOAD_SESSION_TTL_MINUTES * 60 * 1000;

const isUploadSessionExpired = (session) => {
    if (!session?.createdAt) return false;
    const createdAtMs = new Date(session.createdAt).getTime();
    if (!Number.isFinite(createdAtMs)) return false;
    return Date.now() - createdAtMs > UPLOAD_SESSION_TTL_MS;
};

const markSessionExpiredIfNeeded = async (session) => {
    if (!session || !isUploadSessionExpired(session)) return false;

    if (!["COMPLETED", "FAILED"].includes(session.status)) {
        await prisma.uploadSession.update({
            where: { id: session.id },
            data: {
                status: "FAILED",
                cancelledAt: new Date(),
            },
        }).catch(() => null);
    }

    return true;
};

const normalizeTags = (rawTags) => {
    const input = Array.isArray(rawTags)
        ? rawTags
        : typeof rawTags === "string"
            ? rawTags.split(",")
            : [];

    const seen = new Set();
    const normalized = [];

    for (const item of input) {
        if (typeof item !== "string" && typeof item !== "number") {
            continue;
        }

        const tag = normalizeText(item).toLowerCase();
        if (!tag || tag.length > MAX_TAG_LENGTH) continue;
        if (seen.has(tag)) continue;

        seen.add(tag);
        normalized.push(tag);

        if (normalized.length >= MAX_TAGS) break;
    }

    return normalized;
};

const normalizeTranscriptSource = (rawSource) => {
    const source = normalizeText(rawSource).toUpperCase();
    if (!source) return "IMPORTED";
    return ALLOWED_TRANSCRIPT_SOURCES.has(source) ? source : "IMPORTED";
};

const normalizeUploadSessionType = (rawType, normalizedMimeType) => {
    const requestedType = normalizeText(rawType).toLowerCase();

    if (!requestedType) {
        return normalizedMimeType.startsWith("video/") ? "VIDEO" : "IMAGE";
    }

    const typeMap = {
        video: "VIDEO",
        image: "IMAGE",
        avatar: "AVATAR",
        cover: "COVER_IMAGE",
        coverimage: "COVER_IMAGE",
        cover_image: "COVER_IMAGE",
        post: "POST",
        tweet: "TWEET",
        thumbnail: "THUMBNAIL",
    };

    const normalizedType = typeMap[requestedType];
    if (!normalizedType || !ALLOWED_UPLOAD_SESSION_TYPES.has(normalizedType)) {
        throw new ApiError(400, "Invalid uploadType");
    }

    return normalizedType;
};

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
            select: {
                thumbnail: true,
                videoFile: true,
                playbackUrl: true,
                availableQualities: true,
                title: true,
                isShort: true,
                ownerId: true,
                owner: {
                    select: {
                        fullName: true,
                        username: true,
                    },
                },
            },
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

        const streaming = buildVideoStreamingPayload({
            sourceUrl: video.videoFile,
            playbackUrl: video.playbackUrl,
            availableQualities: video.availableQualities,
        });

        await prisma.video.update({
            where: { id: videoId },
            data: {
                processingStatus: "COMPLETED",
                processingCompletedAt: new Date(),
                processingProgress: 100,
                processingStep: "DONE",
                isPublished: true,
                isHlsReady: true,
                playbackUrl: streaming.selectedPlaybackUrl,
                masterPlaylistUrl: streaming.masterPlaylistUrl,
                availableQualities: streaming.availableQualities,
            },
        });

        try {
            const channelName =
                video.owner?.fullName ||
                video.owner?.username ||
                "A channel you follow";

            await dispatchChannelActivityNotification({
                channelId: video.ownerId,
                senderId: video.ownerId,
                activityType: video.isShort ? "SHORT_PUBLISHED" : "VIDEO_PUBLISHED",
                audience: ChannelNotificationAudience.ALL_AND_PERSONALIZED,
                title: video.isShort ? "New short uploaded" : "New video uploaded",
                message: `${channelName} uploaded "${video.title}"`,
                videoId,
                extraData: {
                    channelName,
                    isShort: video.isShort,
                    videoTitle: video.title,
                },
            });
        } catch (notificationError) {
            console.error(
                "Notification dispatch failed (fallback):",
                notificationError?.message || notificationError
            );
        }
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
    const { fileName, fileSize, mimeType, uploadType } = req.body;

    if (!fileName || fileSize === undefined || !mimeType) {
        throw new ApiError(400, "fileName, fileSize, mimeType required");
    }

    const normalizedFileName = normalizeText(fileName);
    const normalizedMimeType = normalizeText(mimeType).toLowerCase();

    if (
        !normalizedFileName ||
        normalizedFileName.length > MAX_UPLOAD_FILENAME_LENGTH
    ) {
        throw new ApiError(400, "Invalid fileName");
    }

    if (
        !normalizedMimeType ||
        normalizedMimeType.length > MAX_UPLOAD_MIMETYPE_LENGTH ||
        (!normalizedMimeType.startsWith("video/") && !normalizedMimeType.startsWith("image/"))
    ) {
        throw new ApiError(400, "Invalid mimeType");
    }

    const numericFileSize = Number(fileSize);

    if (
        !Number.isFinite(numericFileSize) ||
        numericFileSize <= 0 ||
        numericFileSize > MAX_UPLOAD_FILE_SIZE_BYTES
    ) {
        throw new ApiError(400, "Invalid file size");
    }

    const normalizedUploadType = normalizeUploadSessionType(uploadType, normalizedMimeType);

    const session = await prisma.uploadSession.create({
        data: {
            userId: req.user.id,
            status: "INITIATED",
            totalSize: numericFileSize,
            uploadType: normalizedUploadType,
        },
    });

    const safeSession = {
        ...session,
        totalSize: session.totalSize?.toString(),
        uploadedSize: session.uploadedSize?.toString(),
        uploadType: session.uploadType,
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

    const expired = await markSessionExpiredIfNeeded(session);
    if (expired) {
        return res.status(200).json(
            new ApiResponse(200, {}, "Upload session already expired")
        );
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
    const normalizedResourceType = normalizeText(req.query?.resourceType || "video").toLowerCase();

    if (!ALLOWED_SIGNATURE_RESOURCE_TYPES.has(normalizedResourceType)) {
        throw new ApiError(400, "Invalid resourceType");
    }

    if (!req.user.emailVerified) {
        throw new ApiError(403, "Verify email first");
    }

    const timestamp = Math.floor(Date.now() / 1000);

    const folderMap = {
        video: `videos/${req.user.id}`,
        thumbnail: `thumbnails/${req.user.id}`,
        avatar: `avatars/${req.user.id}`,
        post: `tweets/${req.user.id}`,
        tweet: `tweets/${req.user.id}`,
        cover: `covers/${req.user.id}`,
        coverimage: `covers/${req.user.id}`,
    };

    const folder = folderMap[normalizedResourceType];

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
            resourceType: normalizedResourceType,
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

    const expired = await markSessionExpiredIfNeeded(session);
    if (expired) {
        throw new ApiError(
            410,
            `Upload session expired after ${UPLOAD_SESSION_TTL_MINUTES} minutes. Create a new session.`
        );
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

    const rawTitle = normalizeText(req.body?.title);
    const rawDescription = normalizeText(req.body?.description);
    const publicId = normalizeText(req.body?.publicId);
    const thumbnailPublicId = normalizeText(req.body?.thumbnailPublicId);
    const duration = normalizeNumberOrNull(req.body?.duration);
    const width = normalizeNumberOrNull(req.body?.width);
    const height = normalizeNumberOrNull(req.body?.height);
    const tags = normalizeTags(req.body?.tags);
    const isShort = req.body?.isShort ?? false;
    const transcriptInput = req.body?.transcript ?? req.body?.transcriptText ?? "";
    const transcriptCuesInput =
        req.body?.transcriptCues ?? req.body?.cues ?? req.body?.segments ?? null;
    const transcriptLanguage = normalizeText(
        req.body?.transcriptLanguage ?? req.body?.language ?? ""
    ) || null;
    const transcriptSource = normalizeTranscriptSource(
        req.body?.transcriptSource ?? req.body?.source
    );

    if (
        !rawTitle ||
        !rawDescription ||
        !publicId ||
        !thumbnailPublicId
    ) {
        throw new ApiError(400, "Missing required fields");
    }

    if (rawTitle.length > MAX_VIDEO_TITLE_LENGTH) {
        throw new ApiError(400, `title too long (max ${MAX_VIDEO_TITLE_LENGTH})`);
    }

    if (rawDescription.length > MAX_VIDEO_DESCRIPTION_LENGTH) {
        throw new ApiError(400, `description too long (max ${MAX_VIDEO_DESCRIPTION_LENGTH})`);
    }

    if (publicId.length > 300 || thumbnailPublicId.length > 300) {
        throw new ApiError(400, "Invalid public ID length");
    }

    if (normalizeText(transcriptInput).length > MAX_TRANSCRIPT_INPUT_CHARS) {
        throw new ApiError(
            400,
            `transcript too long (max ${MAX_TRANSCRIPT_INPUT_CHARS})`
        );
    }

    const session = await prisma.uploadSession.findUnique({
        where: { id: sessionId },
    });

    if (!session) throw new ApiError(404, "Session not found");

    if (!session.userId || session.userId !== req.user.id) {
        throw new ApiError(403, "Not allowed");
    }

    const expired = await markSessionExpiredIfNeeded(session);
    if (expired) {
        throw new ApiError(
            410,
            `Upload session expired after ${UPLOAD_SESSION_TTL_MINUTES} minutes. Create a new session.`
        );
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
    const sourceHeight = Number(videoResource?.height || height || 0);

    if (!safeVideoUrl || !safeThumbUrl) {
        throw new ApiError(500, "Cloudinary returned invalid media metadata");
    }


    /* ---------- SAFE TAG PARSE ---------- */
    const tagArray = tags;

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
            buildVideoStreamingPayload({
                sourceUrl: safeVideoUrl,
                playbackUrl: null,
                availableQualities: normalizeAvailableQualities([], sourceHeight),
                sourceHeight,
            }).masterPlaylistUrl || safeVideoUrl;

        const availableQualities = normalizeAvailableQualities([], sourceHeight);

        const newVideo = await tx.video.create({
            data: {
                title: rawTitle,
                description: rawDescription,
                duration: duration && duration > 0 ? Math.round(duration) : 0,
                aspectRatio:
                    width && height && width > 0 && height > 0
                        ? `${Math.round(width)}:${Math.round(height)}`
                        : null,

                videoFile: safeVideoUrl,
                playbackUrl: cloudinaryPlaybackUrl,
                masterPlaylistUrl: cloudinaryPlaybackUrl,
                availableQualities,

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

        const hasTranscriptInput =
            Boolean(normalizeText(transcriptInput)) ||
            (Array.isArray(transcriptCuesInput) && transcriptCuesInput.length > 0);

        if (hasTranscriptInput) {
            const parsedTranscript = parseTranscriptInput({
                transcript: transcriptInput,
                cues: transcriptCuesInput,
                durationSeconds: newVideo.duration || duration || null,
            });

            if (!parsedTranscript.transcriptText) {
                throw new ApiError(400, "Invalid transcript input");
            }

            if (parsedTranscript.transcriptText.length > MAX_TRANSCRIPT_INPUT_CHARS) {
                throw new ApiError(
                    400,
                    `transcript too long (max ${MAX_TRANSCRIPT_INPUT_CHARS})`
                );
            }

            await tx.videoTranscript.upsert({
                where: { videoId: newVideo.id },
                update: {
                    transcript: parsedTranscript.transcriptText,
                    segments: parsedTranscript.segments,
                    language: transcriptLanguage,
                    source: transcriptSource,
                    wordCount: parsedTranscript.wordCount,
                    generatedAt: new Date(),
                },
                create: {
                    videoId: newVideo.id,
                    transcript: parsedTranscript.transcriptText,
                    segments: parsedTranscript.segments,
                    language: transcriptLanguage,
                    source: transcriptSource,
                    wordCount: parsedTranscript.wordCount,
                    generatedAt: new Date(),
                },
            });
        }

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

