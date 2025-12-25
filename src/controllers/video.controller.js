import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"
import uploadOnCloudinary, { deleteImageOnCloudinary, deleteVideoOnCloudinary } from "../utils/cloudinary.js"


export const getAllVideos = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "10",
        query = "",
        sortBy = "createdAt",
        sortType = "desc",
        userId
    } = req.query;    //TODO: get all videos based on query, sort, pagination

    page = Number(page)
    limit = Number(limit)

    // fallback if invalid
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    // 3️⃣ Base filter (ALWAYS applied)
    const whereClause = {
        isPublished: true
    };

    if (userId) {
        whereClause.ownerId = userId;
    }

    if (query && query.trim().length > 0) {
        whereClause.OR = [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } }
        ];
    }

    // 6️⃣ Safe sorting (whitelist fields)
    const allowedSortFields = ["createdAt", "views", "title"];
    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "createdAt";
    }

    sortType = sortType === "asc" ? "asc" : "desc";

    // fetch videos
    const allPublishedVideos = await prisma.video.findMany({
        where: { isPublished: true },
        orderBy: {
            [sortBy]: sortType
        },
        skip,
        take: limit,
        select: {
            id: true,
            title: true,
            thumbnail: true,
            views: true,
            duration: true,
            createdAt: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true
                }
            }
        }
    })

    // 8️⃣ Total count for pagination
    const totalVideos = await prisma.video.count({
        where: whereClause
    });

    // 9️⃣ Response
    return res.status(200).json(
        new ApiResponse(
            200,
            {
                videos: allPublishedVideos,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalVideos / limit),
                    totalVideos
                }
            },
            "Videos fetched successfully"
        )
    );

})

export const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body;

    if (!title || !description) {
        throw new ApiError(400, "title & description both field are required");
    }

    const thumbnailLocalPath = req.files?.thumbnail?.[0]?.path;
    const videoFileLocalPath = req.files?.videoFile?.[0]?.path;

    if (!thumbnailLocalPath) {
        throw new ApiError(400, "thumbnail image is required (Local Path missing)");
    }

    if (!videoFileLocalPath) {
        throw new ApiError(400, "videoFile is required (Local Path missing)");
    }

    // 1️⃣ Upload video
    const videoFile = await uploadOnCloudinary(videoFileLocalPath);

    if (!videoFile) {
        throw new ApiError(500, "videoFile upload failed");
    }

    // 2️⃣ Upload thumbnail
    const thumbnail = await uploadOnCloudinary(thumbnailLocalPath);

    if (!thumbnail) {
        // rollback uploaded video
        await deleteVideoOnCloudinary(videoFile.public_id);
        throw new ApiError(500, "thumbnail upload failed");
    }

    // 3️⃣ Extract duration from Cloudinary (IMPORTANT PART)
    const duration = Math.round(videoFile.duration); // seconds (rounded)

    // 4️⃣ Create DB record
    const newVideo = await prisma.video.create({
        data: {
            title,
            description,
            duration,
            videoFile: videoFile.secure_url,
            videoPublicId: videoFile.public_id,
            thumbnail: thumbnail.secure_url,
            thumbnailPublicId: thumbnail.public_id,
            ownerId: req.user.id,
            isPublished: true
        },
        select: {
            id: true,
            title: true,
            description: true,
            thumbnail: true,
            duration: true,
            views: true,
            isPublished: true,
            createdAt: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true
                }
            }
        }
    });

    return res.status(201).json(
        new ApiResponse(201, newVideo, "Video published successfully")
    );
});

export const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const videoDetails = await prisma.video.findUnique({
        where: { id: videoId }, // ✅ correct field
        select: {
            id: true,
            title: true,
            description: true,
            videoFile: true,
            thumbnail: true,
            duration: true,
            views: true,
            isPublished: true,
            createdAt: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true
                }
            }
        }
    });

    if (!videoDetails) {
        throw new ApiError(404, "Video not found");
    }

    // Optional security check (recommended)
    if (!videoDetails.isPublished) {
        throw new ApiError(403, "This video is not published");
    }

    return res.status(200).json(
        new ApiResponse(200, videoDetails, "Video fetched successfully")
    );
});


export const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const { title, description } = req.body;

    // ✅ At least ONE field must be provided
    if (!title && !description && !req.file) {
        throw new ApiError(400, "At least one field is required to update");
    }

    // ✅ Check video existence + ownership
    const existingVideo = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            ownerId: true,
            thumbnailPublicId: true
        }
    });

    if (!existingVideo) {
        throw new ApiError(404, "Video not found");
    }

    // ✅ Ownership check
    if (existingVideo.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to update this video");
    }

    // ✅ Build update object dynamically
    const updateData = {};
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (req.file) {
        const uploaded = await uploadOnCloudinary(req.file.path);

        if (!uploaded) {
            throw new ApiError(500, "Thumbnail upload failed");
        }

        // 🔹 Attempt safe deletion (NON-BLOCKING)
        const deleteResult = await deleteImageOnCloudinary(
            existingVideo.thumbnailPublicId
        );

        // Optional logging (recommended)
        if (!deleteResult || deleteResult.result !== "ok") {
            console.warn(
                "Cloudinary delete failed or asset not found:",
                existingVideo.thumbnailPublicId,
                deleteResult
            );
        }

        updateData.thumbnail = uploaded.secure_url;
        updateData.thumbnailPublicId = uploaded.public_id;
    }



    const updatedVideo = await prisma.video.update({
        where: { id: videoId },
        data: updateData,
        select: {
            id: true,
            title: true,
            description: true,
            thumbnail: true,
            duration: true,
            views: true,
            isPublished: true,
            createdAt: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true
                }
            }
        }
    });

    return res.status(200).json(
        new ApiResponse(200, updatedVideo, "Video details updated successfully")
    );
});


export const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const existingVideo = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            ownerId: true,
            videoPublicId: true,
            thumbnailPublicId: true
        }
    });

    if (!existingVideo) {
        throw new ApiError(404, "Video not found");
    }

    if (existingVideo.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to delete this video");
    }

    // 🔹 Safe Cloudinary deletion (NON-BLOCKING)
    const videoDeleteResult = await deleteVideoOnCloudinary(
        existingVideo.videoPublicId
    );

    if (!videoDeleteResult || videoDeleteResult.result !== "ok") {
        console.warn(
            "Cloudinary video delete failed or not found:",
            existingVideo.videoPublicId,
            videoDeleteResult
        );
    }

    const thumbnailDeleteResult = await deleteImageOnCloudinary(
        existingVideo.thumbnailPublicId
    );

    if (!thumbnailDeleteResult || thumbnailDeleteResult.result !== "ok") {
        console.warn(
            "Cloudinary thumbnail delete failed or not found:",
            existingVideo.thumbnailPublicId,
            thumbnailDeleteResult
        );
    }

    // 🔹 Delete DB record (SOURCE OF TRUTH)
    await prisma.video.delete({
        where: { id: videoId }
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Video deleted successfully")
    );
});


export const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const existingVideo = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            ownerId: true,
            isPublished: true
        }
    });

    if (!existingVideo) {
        throw new ApiError(404, "Video not found");
    }

    if (existingVideo.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to update this video");
    }

    const updatedVideo = await prisma.video.update({
        where: { id: videoId },
        data: {
            isPublished: !existingVideo.isPublished
        },
        select: {
            id: true,
            isPublished: true
        }
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedVideo,
            `Video ${updatedVideo.isPublished ? "published" : "unpublished"} successfully`
        )
    );
});
