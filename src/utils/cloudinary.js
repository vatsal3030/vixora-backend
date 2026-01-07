// import { v2 as cloudinary } from "cloudinary";
// import fs from "fs/promises";


// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
// });

// const uploadOnCloudinary = async (localFilePath) => {
//   try {
//     if (!localFilePath) return null;
//     const response = await cloudinary.uploader.upload(localFilePath, {
//       resource_type: "auto"
//     })
//     // console.log("file uploaded on the cloudinary", response.url);

//     await fs.unlink(localFilePath)

//     return response;
  
//   } catch (error) {
//     try {
//       await fs.unlink(localFilePath);
//     } catch (_) { }

//     // console.error("Cloudinary upload failed:", error.message);
//     return null;
//   }
// }

// export const deleteImageOnCloudinary = async (publicId) => {
//   try {
//     if (!publicId) return null;

//     const response = await cloudinary.uploader.destroy(publicId, {
//       resource_type: "image",
//     });

//     return response;
//   } catch (error) {
//     // console.log(error)
//     return null;
//   }
// };

// export const deleteVideoOnCloudinary = async (publicId) => {
//   try {
//     if (!publicId) return null;

//     const response = await cloudinary.uploader.destroy(publicId, {
//       resource_type: "video",
//     });

//     return response;
//   } catch (error) {
//     // console.log(error)
//     return null;
//   }
// };

// export default uploadOnCloudinary;

// import { v2 as cloudinary } from "cloudinary";
// import fs from "fs/promises";

// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
// });

// /**
//  * Upload local file to Cloudinary
//  * @returns Cloudinary response or throws
//  */
// const uploadOnCloudinary = async (localFilePath, options = {}) => {
//   if (!localFilePath) return null;

//   try {
//     const response = await cloudinary.uploader.upload(localFilePath, {
//       resource_type: "auto",
//       ...options,
//     });

//     // Cleanup local file (best effort)
//     fs.unlink(localFilePath).catch(() => {});

//     return response;
//   } catch (error) {
//     // Cleanup local file if exists
//     fs.unlink(localFilePath).catch(() => {});

//     console.error("❌ Cloudinary upload failed:", error.message);
//     throw error; // 🔥 important
//   }
// };

// /**
//  * Delete asset from Cloudinary
//  * @returns true if deleted, false otherwise
//  */
// const deleteFromCloudinary = async (publicId, resourceType) => {
//   if (!publicId) return true;

//   try {
//     const response = await cloudinary.uploader.destroy(publicId, {
//       resource_type: resourceType,
//     });

//     if (response.result !== "ok" && response.result !== "not found") {
//       console.warn("⚠️ Cloudinary delete response:", response);
//       return false;
//     }

//     return true;
//   } catch (error) {
//     console.error(
//       `❌ Cloudinary ${resourceType} delete failed:`,
//       error.message
//     );
//     return false;
//   }
// };

// export const deleteImageOnCloudinary = (publicId) =>
//   deleteFromCloudinary(publicId, "image");

// export const deleteVideoOnCloudinary = (publicId) =>
//   deleteFromCloudinary(publicId, "video");

// export default uploadOnCloudinary;

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
const uploadOnCloudinary = async (localFilePath, options = {}) => {
  if (!localFilePath) return null;

  try {
    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto",
      ...options,
    });

    // ✅ Proper cleanup
    try {
      await fs.unlink(localFilePath);
    } catch {
      console.warn("⚠️ Local file cleanup failed:", localFilePath);
    }

    return response;
  } catch (error) {
    // Cleanup in failure case too
    try {
      await fs.unlink(localFilePath);
    } catch {}

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
