import { v2 as cloudinary } from "cloudinary";
import fs from "fs/promises";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload local file to Cloudinary
 * @returns Cloudinary response
 */
const uploadOnCloudinary = async (filePathOrUrl, options = {}) => {
  if (!filePathOrUrl) return null;

  const isRemoteUrl = filePathOrUrl.startsWith("http");

  try {
    const response = await cloudinary.uploader.upload(filePathOrUrl, {
      resource_type: "auto",
      ...options,
    });

    // ✅ Only delete if local file
    if (!isRemoteUrl) {
      try {
        await fs.unlink(filePathOrUrl);
      } catch {
        console.warn("⚠️ Local file cleanup failed:", filePathOrUrl);
      }
    }

    return response;

  } catch (error) {

    if (!isRemoteUrl) {
      try {
        await fs.unlink(filePathOrUrl);
      } catch {}
    }

    console.error("❌ Cloudinary upload failed:", error.message);
    throw error;
  }
};


/**
 * Delete asset from Cloudinary
 */
const deleteFromCloudinary = async (publicId, resourceType) => {
  if (!publicId) return true;

  try {
    const response = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });

    return response.result === "ok" || response.result === "not found";
  } catch (error) {
    console.error(
      `❌ Cloudinary ${resourceType} delete failed:`,
      error.message
    );
    return false;
  }
};

/**
 * ✅ NEW: Delete local file explicitly
 */
export const deleteLocalFile = async (filePath) => {
  if (!filePath) return false;

  try {
    await fs.unlink(filePath);
    console.log("🗑️ Local file deleted:", filePath);
    return true;
  } catch (error) {
    console.error("❌ Local file delete failed:", error.message);
    return false;
  }
};

export const deleteImageOnCloudinary = async (publicId) =>
  deleteFromCloudinary(publicId, "image");

export const deleteVideoOnCloudinary = async (publicId) =>
  deleteFromCloudinary(publicId, "video");

export default uploadOnCloudinary;
