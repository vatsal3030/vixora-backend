const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/controllers/video.controller.js');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Fix getUserVideos
const userVideosTarget = `    const videos = await prisma.video.findMany({
        where: whereClause,
        orderBy: {
            [sortBy]: sortType === "asc" ? "asc" : "desc",
        },
        skip,
        take: limit,
    });

    return res.status(200).json(`;

const userVideosReplacement = `    const videos = await prisma.video.findMany({
        where: whereClause,
        orderBy: {
            [sortBy]: sortType === "asc" ? "asc" : "desc",
        },
        skip,
        take: limit,
        select: {
            id: true,
            title: true,
            description: true,
            thumbnail: true,
            videoFile: true,
            duration: true,
            views: true,
            isShort: true,
            createdAt: true,
            playbackUrl: true,
            availableQualities: true,
            processingStatus: true,
            processingProgress: true,
            owner: {
                select: {
                    id: true,
                    username: true,
                    fullName: true,
                    avatar: true,
                },
            },
        },
    });

    const totalVideos = await prisma.video.count({
        where: whereClause,
    });

    return res.status(200).json(`;

code = code.replace(userVideosTarget, userVideosReplacement);

// 2. Fix getUserVideos limit default:
code = code.replace(`let { page = "1", limit = "10", query = "", sortBy = "createdAt", sortType = "desc", isShort } = req.query;`,
`let { page = "1", limit = "20", query = "", sortBy = "createdAt", sortType = "desc", isShort } = req.query;`);

// 3. Fix getMyVideos limit default:
code = code.replace(`        page = "1",\n        limit = "10",`, `        page = "1",\n        limit = "20",`);
code = code.replace(`    if (isNaN(limit) || limit < 1 || limit > 50) limit = 10;`, `    if (isNaN(limit) || limit < 1 || limit > 100) limit = 20;`);

fs.writeFileSync(filePath, code, 'utf8');
console.log('Fixed video.controller.js successfully');
