const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/controllers/video.controller.js');
let code = fs.readFileSync(filePath, 'utf8');

const target = `export const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            ownerId: true,
            processingStatus: true,
            isHlsReady: true,
            isDeleted: true,
            isPublished: true,
            title: true,
            thumbnail: true,
            duration: true,
            views: true,
            createdAt: true,
            isShort: true,
            aspectRatio: true,
            deletedAt: true,
            playbackUrl: true,
            availableQualities: true,
            processingStatus: true,
            processingProgress: true,
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

    const formattedVideos = videos.map(video => ({
        ...video,
        tags: video.tags.map(t => t.tag.name)
    }));

    const totalVideos = await prisma.video.count({
        where: whereClause,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "videos",
                items: formattedVideos,
                currentPage: page,
                limit,
                totalItems: totalVideos,
                legacyTotalKey: "totalVideos",
            }),
            "Videos fetched successfully"
        )
    );
});`;

const replacement = `export const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            id: true,
            ownerId: true,
            processingStatus: true,
            isHlsReady: true,
            isDeleted: true,
            isPublished: true,
        },
    });

    if (!video) throw new ApiError(404, "Video not found");

    if (video.ownerId !== req.user.id) {
        throw new ApiError(403, "Not allowed");
    }

    if (video.isDeleted) {
        throw new ApiError(400, "Already deleted");
    }

    if (video.processingStatus !== "COMPLETED" || !video.isHlsReady) {
        throw new ApiError(400, "Video still processing");
    }

    await prisma.video.update({
        where: { id: videoId },
        data: {
            isDeleted: true,
            isPublished: false,
            deletedAt: new Date(),
        },
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Video deleted. You can restore it within 7 days."
        )
    );
});

export const getAllDeletedVideos = asyncHandler(async (req, res) => {
    let { page = "1", limit = "20", sortBy = "createdAt", sortType = "desc", isShort } = req.query;

    page = Number(page);
    limit = Number(limit);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1 || limit > 100) limit = 20;

    const skip = (page - 1) * limit;

    const whereClause = {
        ownerId: req.user.id,
        isDeleted: true,
        deletedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
        processingStatus: "COMPLETED",
        isHlsReady: true,
    };

    if (isShort !== undefined) {
        whereClause.isShort = isShort === "true";
    }

    const allowedSortFields = ["createdAt", "views", "duration"];

    if (!allowedSortFields.includes(sortBy)) {
        sortBy = "createdAt";
    }

    const videos = await prisma.video.findMany({
        where: whereClause,
        orderBy: {
            [sortBy]: sortType === "asc" ? "asc" : "desc",
        },
        skip,
        take: limit,
        select: {
            id: true,
            title: true,
            thumbnail: true,
            duration: true,
            views: true,
            createdAt: true,
            isShort: true,
            aspectRatio: true,
            deletedAt: true,
            playbackUrl: true,
            availableQualities: true,
            processingStatus: true,
            processingProgress: true,
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

    const formattedVideos = videos.map(video => ({
        ...video,
        tags: video.tags.map(t => t.tag.name)
    }));

    const totalVideos = await prisma.video.count({
        where: whereClause,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            buildPaginatedListData({
                key: "videos",
                items: formattedVideos,
                currentPage: page,
                limit,
                totalItems: totalVideos,
                legacyTotalKey: "totalVideos",
            }),
            "Deleted videos fetched successfully"
        )
    );
});`;

// Normalize line endings
code = code.replace(/\r\n/g, '\n');
const normTarget = target.replace(/\r\n/g, '\n');
const normReplacement = replacement.replace(/\r\n/g, '\n');

if (code.includes(normTarget)) {
    code = code.replace(normTarget, normReplacement);
    fs.writeFileSync(filePath, code, 'utf8');
    console.log('Successfully replaced deleteVideo and added getAllDeletedVideos');
} else {
    console.error('Target not found in video.controller.js');
}
