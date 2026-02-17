import { v2 as cloudinary } from "cloudinary";
import ApiError from "./ApiError.js";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const normalizeResourceTypes = (resourceTypes) => {
    if (!Array.isArray(resourceTypes) || resourceTypes.length === 0) {
        return ["image"];
    }

    return resourceTypes
        .filter((t) => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim().toLowerCase());
};

const getCloudinaryErrorCode = (error) => {
    const code =
        error?.http_code ??
        error?.statusCode ??
        error?.status ??
        error?.response?.status;

    return Number.isFinite(Number(code)) ? Number(code) : null;
};

const getCloudinaryErrorMessage = (error) => {
    return (
        error?.message ||
        error?.error?.message ||
        error?.response?.data?.error?.message ||
        error?.http_body ||
        "Unknown Cloudinary error"
    );
};

export const verifyCloudinaryAssetOwnership = async (
    publicId,
    expectedFolder,
    options = {}
) => {
    if (!publicId) {
        throw new ApiError(400, "Missing Cloudinary public ID");
    }

    const resourceTypes = normalizeResourceTypes(options.resourceTypes);
    let resource = null;

    for (const resourceType of resourceTypes) {
        try {
            resource = await cloudinary.api.resource(publicId, { resource_type: resourceType });
            if (resource) break;
        } catch (error) {
            const code = getCloudinaryErrorCode(error);

            // Wrong resource type often returns 404. Try next resource type first.
            if (code === 404) {
                continue;
            }

            throw new ApiError(
                code && code >= 400 && code < 500 ? code : 500,
                `Cloudinary lookup failed: ${getCloudinaryErrorMessage(error)}`
            );
        }
    }

    if (!resource) {
        throw new ApiError(404, "Cloudinary asset not found");
    }

    if (expectedFolder) {
        const actualFolder = resource.public_id.split("/").slice(0, -1).join("/");

        if (actualFolder !== expectedFolder) {
            throw new ApiError(403, "Cloudinary asset folder mismatch");
        }
    }


    return resource;
};
