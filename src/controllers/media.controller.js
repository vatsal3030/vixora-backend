import asyncHandler from "../utils/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import ApiError from "../utils/ApiError.js";
import prisma from "../db/prisma.js";
import { verifyCloudinaryAssetOwnership } from "../utils/verifyCloudinaryAsset.js";
import {
  updateUserImage,
  deleteUserImage,
  normalizeImageType
} from "../services/media.service.js";

const DEFAULT_UPLOAD_SESSION_TTL_MINUTES = 120;
const MAX_CLOUDINARY_PUBLIC_ID_LENGTH = 300;
const ALLOWED_IMAGE_SESSION_TYPES = new Set(["IMAGE", "AVATAR", "COVER_IMAGE"]);

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

/*
FINALIZE IMAGE UPLOAD
*/
export const finalizeImageUpload = asyncHandler(async (req, res) => {

  const { sessionId } = req.params;

  const {
    uploadType,
    publicId
  } = req.body;

  if (!req.user?.emailVerified) {
    throw new ApiError(403, "Verify email first");
  }

  const normalizedType = normalizeImageType(uploadType);
  const normalizedPublicId = String(publicId || "").trim();

  if (!normalizedType || !normalizedPublicId) {
    throw new ApiError(400, "Missing required fields");
  }

  if (normalizedPublicId.length > MAX_CLOUDINARY_PUBLIC_ID_LENGTH) {
    throw new ApiError(400, "Invalid public ID");
  }

  const session = await prisma.uploadSession.findUnique({
    where: { id: sessionId }
  });

  if (!session) throw new ApiError(404, "Session not found");

  if (session.userId !== req.user.id) {
    throw new ApiError(403, "Not allowed");
  }

  if (session.status === "FAILED") {
    throw new ApiError(400, "Upload session is cancelled or failed");
  }

  if (session.status === "COMPLETED") {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        avatar: true,
        coverImage: true,
        avatarPublicId: true,
        coverImagePublicId: true,
      },
    });

    return res.status(200).json(
      new ApiResponse(200, user, "Image upload already finalized")
    );
  }

  if (!["INITIATED", "UPLOADING", "PROCESSING"].includes(session.status)) {
    throw new ApiError(400, "Invalid upload session state");
  }

  if (isUploadSessionExpired(session)) {
    if (!["COMPLETED", "FAILED"].includes(session.status)) {
      await prisma.uploadSession.update({
        where: { id: session.id },
        data: {
          status: "FAILED",
          cancelledAt: new Date(),
        },
      }).catch(() => null);
    }

    throw new ApiError(
      410,
      `Upload session expired after ${UPLOAD_SESSION_TTL_MINUTES} minutes. Create a new session.`
    );
  }

  const normalizedSessionType = String(session.uploadType || "")
    .trim()
    .toUpperCase();

  if (normalizedSessionType && !ALLOWED_IMAGE_SESSION_TYPES.has(normalizedSessionType)) {
    throw new ApiError(400, "Upload session is not valid for image finalization");
  }

  /* ---------- CLOUDINARY OWNERSHIP VERIFY ---------- */

  const folderMap = {
    avatar: `avatars/${req.user.id}`,
    coverImage: `covers/${req.user.id}`
  };

  const expectedFolder = folderMap[normalizedType];

  if (!expectedFolder) {
    throw new ApiError(400, "Unsupported upload type");
  }

  const resource = await verifyCloudinaryAssetOwnership(
    normalizedPublicId,
    expectedFolder,
    { resourceTypes: ["image"] }
  );

  const result = await updateUserImage({
    userId: req.user.id,
    type: normalizedType,
    url: resource.secure_url,
    publicId: resource.public_id
  });

  await prisma.uploadSession.update({
    where: { id: sessionId },
    data: {
      status: "COMPLETED",
      uploadType: normalizedType === "avatar" ? "AVATAR" : "COVER_IMAGE",
    }
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Image upload finalized")
  );
});

/*
DELETE IMAGE
*/
export const deleteImage = asyncHandler(async (req, res) => {

  const { type } = req.params;

  const result = await deleteUserImage({
    userId: req.user.id,
    type
  });

  return res.status(200).json(
    new ApiResponse(200, result, "Image deleted")
  );
});
