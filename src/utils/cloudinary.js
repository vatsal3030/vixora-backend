import { v2 as cloudinary } from "cloudinary";
import fs from "fs/promises";


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadOnCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) return null;
    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto"
    })
    // console.log("file uploaded on the cloudinary", response.url);

    await fs.unlink(localFilePath)

    return response;
  
  } catch (error) {
    try {
      await fs.unlink(localFilePath);
    } catch (_) { }

    // console.error("Cloudinary upload failed:", error.message);
    return null;
  }
}

export const deleteImageOnCloudinary = async (publicId) => {
  try {
    if (!publicId) return null;

    const response = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
    });

    return response;
  } catch (error) {
    // console.log(error)
    return null;
  }
};

export const deleteVideoOnCloudinary = async (publicId) => {
  try {
    if (!publicId) return null;

    const response = await cloudinary.uploader.destroy(publicId, {
      resource_type: "video",
    });

    return response;
  } catch (error) {
    // console.log(error)
    return null;
  }
};

export default uploadOnCloudinary;


