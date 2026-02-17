import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import {
  deleteImageOnCloudinary
} from "../utils/cloudinary.js";

/*
UPDATE USER IMAGE (AVATAR / COVER)
*/
export const updateUserImage = async ({
  userId,
  type,
  url,
  publicId
}) => {

  if (!["avatar", "coverImage"].includes(type)) {
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
    type === "avatar"
      ? user.avatarPublicId
      : user.coverImagePublicId;

  if (oldPublicId) {
    await deleteImageOnCloudinary(oldPublicId);
  }

  /* UPDATE DB */

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data:
      type === "avatar"
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

  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) throw new ApiError(404, "User not found");

  const publicId =
    type === "avatar"
      ? user.avatarPublicId
      : user.coverImagePublicId;

  if (publicId) {
    await deleteImageOnCloudinary(publicId);
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data:
      type === "avatar"
        ? { avatar: null, avatarPublicId: null }
        : { coverImage: null, coverImagePublicId: null }
  });

  return updatedUser;
};
