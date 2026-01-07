import prisma from "../db/prisma.js"
import ApiError from "../utils/ApiError.js"
import ApiResponse from "../utils/ApiResponse.js"
import asyncHandler from "../utils/asyncHandler.js"

export const getAllNotifications = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    let {
        page = "1",
        limit = "10"
    } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    const skip = (page - 1) * limit;

    // 🔢 Total count for pagination metadata
    const total = await prisma.notification.count({
        where: { userId }
    });

    const notifications = await prisma.notification.findMany({
        where: {
            userId: userId
        },
        orderBy: {
            createdAt: "desc"
        },
        skip,
        take: limit,
        include: {
            sender: {
                select: {
                    id: true,
                    fullName: true,
                    username: true,
                    avatar: true
                }
            },
            video: {
                select: {
                    id: true,
                    title: true,
                    thumbnail: true,
                    duration: true,
                    views: true,
                    isPublished: true,
                    createdAt: true,
                    owner: {
                        select: {
                            id: true,
                            fullName: true,
                            username: true,
                            avatar: true
                        }
                    }
                }
            }
        },

    });

    const formatted = notifications.map(n => ({
        id: n.id,
        isRead: n.isRead,
        createdAt: n.createdAt,

        message: n.message,
        title: n.title,

        sender: n.sender,

        video: n.video ? {
            id: n.video.id,
            title: n.video.title,
            thumbnail: n.video.thumbnail,
            duration: n.video.duration,
            views: n.video.views,
            uploadedAt: n.video.createdAt,
            channel: n.video.owner
        } : null
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                notifications: formatted,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit)
                }
            },
            "All notifications fetched"
        )
    );
});

export const getUnreadNotificationCount = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const count = await prisma.notification.count({
        where: {
            userId,
            isRead: false
        }
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            { unreadCount: count },
            "Unread notification count fetched"
        )
    );
});

export const getUnreadNotifications = asyncHandler(async (req, res) => {

    const userId = req.user.id;

    let {
        page = "1",
        limit = "10"
    } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    const skip = (page - 1) * limit;

    const totalUnread = await prisma.notification.count({
        where: { userId, isRead: false }
    });

    const unread = await prisma.notification.findMany({
        where: {
            userId,
            isRead: false
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
            id: true,
            title: true,
            message: true,
            isRead: true,
            createdAt: true,
            senderId: true
        }
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                notifications: unread,
                pagination: {
                    total: totalUnread,
                    page,
                    limit,
                    totalPages: Math.ceil(totalUnread / limit)
                }
            },
            "Unread notifications fetched"
        )
    );
});


export const markNotificationRead = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;
    const userId = req.user.id;

    const notification = await prisma.notification.findUnique({
        where: { id: notificationId }
    });

    if (!notification || notification.userId !== userId) {
        throw new ApiError(404, "Notification not found");
    }

    await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true }
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Notification marked as read")
    );
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    await prisma.notification.updateMany({
        where: {
            userId,
            isRead: false
        },
        data: {
            isRead: true
        }
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "All notifications marked as read")
    );
});

export const deleteNotification = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;
    const userId = req.user.id;

    const notification = await prisma.notification.findUnique({
        where: { id: notificationId }
    });

    if (!notification || notification.userId !== userId) {
        throw new ApiError(404, "Notification not found");
    }

    await prisma.notification.delete({
        where: { id: notificationId }
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Notification deleted")
    );
});

export const deleteAllNotifications = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const result = await prisma.notification.deleteMany({
        where: { userId }
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            { deletedCount: result.count },
            "All notifications deleted"
        )
    );
});

