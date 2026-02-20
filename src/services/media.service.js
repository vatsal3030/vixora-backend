import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import {
  deleteImageOnCloudinary
} from "../utils/cloudinary.js";

export const normalizeImageType = (rawType) => {
  const normalized = String(rawType ?? "").trim().toLowerCase();

  if (normalized === "avatar") return "avatar";
  if (["coverimage", "cover", "cover_image"].includes(normalized)) {
    return "coverImage";
  }

  return null;
};

/*
UPDATE USER IMAGE (AVATAR / COVER)
*/
export const updateUserImage = async ({
  userId,
  type,
  url,
  publicId
}) => {

  const normalizedType = normalizeImageType(type);

  if (!normalizedType) {
    throw new ApiError(400, "Invalid image type");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      avatarPublicId: true,
      coverImagePublicId: true
    }
  });

  if (!user) throw new ApiError(404, "User not found");

  /* DELETE OLD IMAGE */

  const oldPublicId =
    normalizedType === "avatar"
      ? user.avatarPublicId
      : user.coverImagePublicId;

  if (oldPublicId) {
    await deleteImageOnCloudinary(oldPublicId).catch((error) => {
      console.error("Failed to delete previous image on Cloudinary:", error?.message || error);
    });
  }

  /* UPDATE DB */

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data:
      normalizedType === "avatar"
        ? {
          avatar: url,
          avatarPublicId: publicId
        }
        : {
          coverImage: url,
          coverImagePublicId: publicId
        },
    select: {
      id: true,
      avatar: true,
      coverImage: true
    }
  });

  return updatedUser;
};

/*
DELETE USER IMAGE
*/
export const deleteUserImage = async ({
  userId,
  type
}) => {
  const normalizedType = normalizeImageType(type);

  if (!normalizedType) {
    throw new ApiError(400, "Invalid image type");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      avatarPublicId: true,
      coverImagePublicId: true
    }
  });

  if (!user) throw new ApiError(404, "User not found");

  const publicId =
    normalizedType === "avatar"
      ? user.avatarPublicId
      : user.coverImagePublicId;

  if (publicId) {
    await deleteImageOnCloudinary(publicId).catch((error) => {
      console.error("Failed to delete image on Cloudinary:", error?.message || error);
    });
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data:
      normalizedType === "avatar"
        ? { avatar: null, avatarPublicId: null }
        : { coverImage: null, coverImagePublicId: null },
    select: {
      id: true,
      avatar: true,
      coverImage: true
    }
  });

  return updatedUser;
};
