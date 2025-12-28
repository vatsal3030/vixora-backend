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
        isShort = "false",
        tags = "" // ✅ added
    } = req.query;


    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    // ✅ Base filter
    const whereClause = {
        isPublished: true
    };

    if (isShort !== undefined) {
        whereClause.isShort = isShort === "true";
    }

    // 🔍 Search by title / description
    if (query && query.trim().length > 0) {
        whereClause.OR = [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } }
        ];
    }

    // 🔖 Tag filtering (comma separated)
    if (tags) {
        const tagArray = tags.split(",").map(t => t.trim().toLowerCase());

        whereClause.tags = {
            some: {
                tag: {
                    name: { in: tagArray }
                }
            }
        };
    }

    // Sorting
    const allowedSortFields = ["createdAt", "views", "title"];
    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "createdAt";
    }

    sortType = sortType === "asc" ? "asc" : "desc";

    const allPublishedVideos = await prisma.video.findMany({
        where: whereClause,
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
    });

    const totalVideos = await prisma.video.count({
        where: whereClause
    });

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
});

export const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description, tags = [] } = req.body;

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
    if (!videoFile) throw new ApiError(500, "videoFile upload failed");

    // 2️⃣ Upload thumbnail
    const thumbnail = await uploadOnCloudinary(thumbnailLocalPath);
    if (!thumbnail) {
        await deleteVideoOnCloudinary(videoFile.public_id);
        throw new ApiError(500, "thumbnail upload failed");
    }

    // 3️⃣ Duration & short logic
    const duration = Math.round(videoFile.duration);
    const isShort =
        req.body.isShort !== undefined
            ? req.body.isShort === "true" || req.body.isShort === true
            : duration <= 60;

    const aspectRatio = videoFile.width && videoFile.height
        ? `${videoFile.width}:${videoFile.height}`
        : null;

    let tagArray = [];

    if (Array.isArray(tags)) {
        tagArray = tags;
    } else if (typeof tags === "string") {
        try {
            tagArray = JSON.parse(tags);
        } catch {
            tagArray = tags.split(","); // fallback
        }
    }

    tagArray = tagArray.map(t => t.toLowerCase().trim());

    const newVideo = await prisma.$transaction(async (tx) => {
        // 1. Ensure tags exist
        await tx.tag.createMany({
            data: tagArray.map(name => ({ name })),
            skipDuplicates: true
        });

        const tagRecords = await tx.tag.findMany({
            where: {
                name: { in: tagArray }
            },
            select: { id: true }
        });

        // 2. Create video
        const video = await tx.video.create({
            data: {
                title,
                description,
                duration,
                isShort,
                aspectRatio,
                videoFile: videoFile.secure_url,
                videoPublicId: videoFile.public_id,
                thumbnail: thumbnail.secure_url,
                thumbnailPublicId: thumbnail.public_id,
                ownerId: req.user.id,
                isPublished: true,
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
                isShort: true,
                aspectRatio: true,
                owner: {
                    select: {
                        id: true,
                        username: true,
                        avatar: true
                    }
                }
            }
        });

        // 3. Attach tags
        await tx.videoTag.createMany({
            data: tagRecords.map(tag => ({
                videoId: video.id,
                tagId: tag.id
            }))
        });

        return video;
    });


    if (newVideo.isPublished) {
        // 🔔 Notify subscribers who enabled notifications
        const subscribers = await prisma.subscription.findMany({
            where: {
                channelId: req.user.id,
            },
            select: {
                subscriberId: true
            }
        });

        if (subscribers.length > 0) {
            await prisma.notification.createMany({
                data: subscribers.map(sub => ({
                    userId: sub.subscriberId,
                    videoId: newVideo.id
                }))
            });
        }
    }

    if (newVideo.isShort) {
        return res.status(201).json(
            new ApiResponse(201, newVideo, "Short published successfully")
        );
    }

    return res.status(201).json(
        new ApiResponse(201, newVideo, "Video published successfully")
    );
});

export const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const userId = req.user?.id || null;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const video = await prisma.video.findUnique({
        where: { id: videoId },
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
            },
            tags: {
                select: {
                    tag: {
                        select: { name: true }
                    }
                }
            }
        }
    });

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    // 🔐 Access control
    if (!video.isPublished && video.owner.id !== userId) {
        throw new ApiError(403, "This video is not published");
    }

    // 👁️ Increase view count (only if viewer is not owner)
    if (video.owner.id !== userId) {
        await prisma.video.update({
            where: { id: videoId },
            data: { views: { increment: 1 } }
        });
    }

    // Format tags
    const formattedVideo = {
        ...video,
        tags: video.tags.map(t => t.tag.name)
    };

    return res.status(200).json(
        new ApiResponse(200, formattedVideo, "Video fetched successfully")
    );
});

export const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { title, description } = req.body;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    // At least one field required
    if (!title && !description && !req.file?.thumbnail) {
        throw new ApiError(400, "At least one field is required to update");
    }

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

    if (existingVideo.ownerId !== req.user.id) {
        throw new ApiError(403, "You are not allowed to update this video");
    }

    const updateData = {};

    if (title) updateData.title = title;
    if (description) updateData.description = description;

    // 🖼️ Thumbnail update
    if (req.files?.thumbnail?.[0]) {
        const uploaded = await uploadOnCloudinary(req.files.thumbnail[0].path);

        if (!uploaded) {
            throw new ApiError(500, "Thumbnail upload failed");
        }

        await deleteImageOnCloudinary(existingVideo.thumbnailPublicId);

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
            isShort: true,
            aspectRatio: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    avatar: true
                }
            }
        }
    });

    if (updatedVideo.isShort) {
        return res.status(200).json(
            new ApiResponse(200, updatedVideo, "Short details updated successfully")
        );
    }

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

    // ✅ Transaction-safe deletion
    await prisma.$transaction(async (tx) => {
        await tx.like.deleteMany({ where: { videoId } });
        await tx.comment.deleteMany({ where: { videoId } });
        await tx.videoTag.deleteMany({ where: { videoId } });

        // delete video record LAST
        await tx.video.delete({ where: { id: videoId } });
    });

    // ☁️ Cloudinary cleanup (outside transaction)
    const videoDeleteResult = await deleteVideoOnCloudinary(existingVideo.videoPublicId);
    if (!videoDeleteResult || videoDeleteResult.result !== "ok") {
        console.warn("Video Cloudinary delete failed:", existingVideo.videoPublicId);
    }

    const thumbnailDeleteResult = await deleteImageOnCloudinary(existingVideo.thumbnailPublicId);
    if (!thumbnailDeleteResult || thumbnailDeleteResult.result !== "ok") {
        console.warn("Thumbnail Cloudinary delete failed:", existingVideo.thumbnailPublicId);
    }

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

export const getMyVideos = asyncHandler(async (req, res) => {
    let {
        page = "1",
        limit = "10",
        query = "",
        isShort = "false",
        sortBy = "createdAt",
        sortType = "desc",
        tags = "" // ✅ added
    } = req.query;

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;

    const skip = (page - 1) * limit;

    const userId = req.user?.id
    if (!userId) throw new ApiError(401, "Unauthorized");
    // ✅ Base filter
    const whereClause = {
        ownerId: userId
    };


    // 🔍 Search by title / description
    if (query && query.trim().length > 0) {
        whereClause.OR = [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } }
        ];
    }

    // 🔖 Tag filtering (comma separated)
    if (tags) {
        const tagArray = tags
            .split(",")
            .map(t => t.trim().toLowerCase())
            .filter(Boolean);


        whereClause.tags = {
            some: {
                tag: {
                    name: { in: tagArray }
                }
            }
        };
    }

    // Sorting
    const allowedSortFields = ["createdAt", "views", "title"];
    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "createdAt";
    }

    sortType = sortType === "asc" ? "asc" : "desc";

    if (isShort !== undefined) {
        whereClause.isShort = isShort === "true";
    }


    const allPublishedVideos = await prisma.video.findMany({
        where: whereClause,
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
    });

    const totalVideos = await prisma.video.count({
        where: whereClause
    });

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
            "Shorts fetched successfully"
        )
    );
});



