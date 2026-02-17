import asyncHandler from "../utils/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import ApiError from "../utils/ApiError.js";
import prisma from "../db/prisma.js";
import { verifyCloudinaryAssetOwnership } from "../utils/verifyCloudinaryAsset.js";
import {
  updateUserImage,
  deleteUserImage
} from "../services/media.service.js";

/*
FINALIZE IMAGE UPLOAD
*/
export const finalizeImageUpload = asyncHandler(async (req, res) => {

  const { sessionId } = req.params;

  const {
    uploadType, // avatar | coverImage | post
    cloudinaryUrl,
    publicId
  } = req.body;

  if (!uploadType || !cloudinaryUrl || !publicId) {
    throw new ApiError(400, "Missing required fields");
  }

  const session = await prisma.uploadSession.findUnique({
    where: { id: sessionId }
  });

  if (!session) throw new ApiError(404, "Session not found");

  if (session.userId !== req.user.id) {
    throw new ApiError(403, "Not allowed");
  }
  
  /* ---------- CLOUDINARY OWNERSHIP VERIFY ---------- */

  const folderMap = {
    avatar: `avatars/${req.user.id}`,
    coverImage: `covers/${req.user.id}`,
    post: `posts/${req.user.id}`
  };

  const expectedFolder = folderMap[uploadType];

  await verifyCloudinaryAssetOwnership(publicId, expectedFolder);

  let result;

  switch (uploadType) {

    case "avatar":
      result = await updateUserImage({
        userId: req.user.id,
        type: "avatar",
        url: cloudinaryUrl,
        publicId
      });
      break;

    case "coverImage":
      result = await updateUserImage({
        userId: req.user.id,
        type: "coverImage",
        url: cloudinaryUrl,
        publicId
      });
      break;

    default:
      throw new ApiError(400, "Unsupported upload type");
  }

  await prisma.uploadSession.update({
    where: { id: sessionId },
    data: { status: "COMPLETED" }
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
