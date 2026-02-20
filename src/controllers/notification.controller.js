import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { sanitizePagination } from "../utils/pagination.js";
import { sanitizeSort } from "../utils/sanitizeSort.js";
import { buildPaginatedListData } from "../utils/listResponse.js";

const NOTIFICATION_TYPES = new Set([
  "COMMENT",
  "LIKE",
  "SUBSCRIPTION",
  "UPLOAD",
  "MENTION",
  "SYSTEM",
]);

const ALLOWED_SORT_FIELDS = ["createdAt", "type", "isRead"];

const normalizeText = (value) => String(value ?? "").trim();

const normalizeBoolean = (value) => {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return undefined;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return undefined;
};

const normalizeDate = (value) => {
  const raw = normalizeText(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildNotificationFilter = ({ userId, query, forceUnread = false }) => {
  const where = { userId };

  if (forceUnread) {
    where.isRead = false;
  } else {
    const isRead = normalizeBoolean(query?.isRead);
    if (isRead !== undefined) {
      where.isRead = isRead;
    }
  }

  const type = normalizeText(query?.type).toUpperCase();
  if (type && NOTIFICATION_TYPES.has(type)) {
    where.type = type;
  }

  const channelId = normalizeText(query?.channelId);
  if (channelId) {
    where.senderId = channelId;
  }

  const fromDate = normalizeDate(query?.from);
  const toDate = normalizeDate(query?.to);
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate) where.createdAt.lte = toDate;
  }

  const q = normalizeText(query?.q).slice(0, 100);
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { message: { contains: q, mode: "insensitive" } },
      {
        sender: {
          is: {
            username: { contains: q, mode: "insensitive" },
          },
        },
      },
      {
        sender: {
          is: {
            fullName: { contains: q, mode: "insensitive" },
          },
        },
      },
    ];
  }

  let sortBy = normalizeText(query?.sortBy || "createdAt");
  if (sortBy.toLowerCase() === "time") {
    sortBy = "createdAt";
  }

  const sortTypeRaw = normalizeText(query?.sortType || "desc");
  const { sortBy: safeSortBy, sortType } = sanitizeSort(
    sortBy,
    sortTypeRaw,
    ALLOWED_SORT_FIELDS,
    "createdAt"
  );

  return {
    where,
    orderBy: { [safeSortBy]: sortType },
    filters: {
      isRead: forceUnread ? false : normalizeBoolean(query?.isRead),
      type: type && NOTIFICATION_TYPES.has(type) ? type : null,
      channelId: channelId || null,
      q: q || null,
      from: fromDate ? fromDate.toISOString() : null,
      to: toDate ? toDate.toISOString() : null,
      sortBy: safeSortBy,
      sortType,
    },
  };
};

const formatNotification = (notification) => ({
  id: notification.id,
  isRead: notification.isRead,
  createdAt: notification.createdAt,
  message: notification.message,
  title: notification.title,
  type: notification.type,
  data: notification.data ?? null,
  sender: notification.sender
    ? {
        id: notification.sender.id,
        fullName: notification.sender.fullName,
        username: notification.sender.username,
        avatar: notification.sender.avatar,
      }
    : null,
  video: notification.video
    ? {
        id: notification.video.id,
        title: notification.video.title,
        thumbnail: notification.video.thumbnail,
        duration: notification.video.duration,
        views: notification.video.views,
        isPublished: notification.video.isPublished,
        uploadedAt: notification.video.createdAt,
        channel: notification.video.owner
          ? {
              id: notification.video.owner.id,
              fullName: notification.video.owner.fullName,
              username: notification.video.owner.username,
              avatar: notification.video.owner.avatar,
            }
          : null,
      }
    : null,
});

const listNotifications = async ({
  userId,
  query,
  forceUnread = false,
}) => {
  const { page, limit, skip } = sanitizePagination(query?.page, query?.limit);
  const { where, orderBy, filters } = buildNotificationFilter({
    userId,
    query,
    forceUnread,
  });

  const [total, notifications] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatar: true,
          },
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
                avatar: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return buildPaginatedListData({
    key: "notifications",
    items: notifications.map(formatNotification),
    currentPage: page,
    limit,
    totalItems: total,
    extra: { filters },
  });
};

export const getAllNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await listNotifications({
    userId,
    query: req.query,
    forceUnread: false,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      result,
      "All notifications fetched"
    )
  );
});

export const getUnreadNotificationCount = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { where, filters } = buildNotificationFilter({
    userId,
    query: req.query,
    forceUnread: true,
  });

  const unreadCount = await prisma.notification.count({ where });

  return res.status(200).json(
    new ApiResponse(
      200,
      { unreadCount, filters },
      "Unread notification count fetched"
    )
  );
});

export const getUnreadNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await listNotifications({
    userId,
    query: req.query,
    forceUnread: true,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      result,
      "Unread notifications fetched"
    )
  );
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;
  const userId = req.user.id;

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { id: true, userId: true },
  });

  if (!notification || notification.userId !== userId) {
    throw new ApiError(404, "Notification not found");
  }

  await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
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
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });

  return res.status(200).json(
    new ApiResponse(200, {}, "All notifications marked as read")
  );
});

export const deleteNotification = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;
  const userId = req.user.id;

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { id: true, userId: true },
  });

  if (!notification || notification.userId !== userId) {
    throw new ApiError(404, "Notification not found");
  }

  await prisma.notification.delete({
    where: { id: notificationId },
  });

  return res.status(200).json(
    new ApiResponse(200, {}, "Notification deleted")
  );
});

export const deleteAllNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await prisma.notification.deleteMany({
    where: { userId },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      { deletedCount: result.count },
      "All notifications deleted"
    )
  );
});
