import prisma from "../db/prisma.js";
import { emitToUser } from "../realtime/socket.server.js";

const CHANNEL_ACTIVITY_AUDIENCE = {
  ALL_ONLY: "ALL_ONLY",
  ALL_AND_PERSONALIZED: "ALL_AND_PERSONALIZED",
};

const SOCKET_EVENT_NOTIFICATION_NEW = "notification:new";
const DEFAULT_NOTIFICATION_DEDUP_WINDOW_MINUTES = 30;

const parsePositiveInt = (value, fallbackValue) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallbackValue;
  return parsed;
};

const cleanEnv = (value) => {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).trim();
  }
  return raw;
};

const NOTIFICATION_DEDUP_WINDOW_MINUTES = parsePositiveInt(
  cleanEnv(process.env.NOTIFICATION_DEDUP_WINDOW_MINUTES),
  DEFAULT_NOTIFICATION_DEDUP_WINDOW_MINUTES
);

const resolveAllowedBellLevels = (audience) => {
  if (audience === CHANNEL_ACTIVITY_AUDIENCE.ALL_ONLY) {
    return ["ALL"];
  }

  return ["ALL", "PERSONALIZED"];
};

const normalizeActivityPayload = ({
  activityType,
  channelId,
  senderId,
  title,
  message,
  videoId = null,
  extraData = {},
}) => {
  return {
    type: "UPLOAD",
    title: String(title || "").trim(),
    message: String(message || "").trim(),
    senderId: senderId || channelId || null,
    videoId: videoId || null,
    data: {
      activityType,
      channelId,
      ...extraData,
    },
  };
};

const buildDedupKey = ({ type, senderId, videoId, activityType }) => {
  return [
    String(type || "").trim().toUpperCase(),
    String(senderId || "").trim(),
    String(videoId || "").trim(),
    String(activityType || "").trim().toUpperCase(),
  ].join("|");
};

const filterDeduplicatedTargets = async ({
  targets,
  payload,
  now,
}) => {
  if (!Array.isArray(targets) || targets.length === 0) {
    return { finalTargets: [], skippedByDedup: 0 };
  }

  if (NOTIFICATION_DEDUP_WINDOW_MINUTES <= 0) {
    return { finalTargets: targets, skippedByDedup: 0 };
  }

  const dedupKey = buildDedupKey({
    type: payload.type,
    senderId: payload.senderId,
    videoId: payload.videoId,
    activityType: payload.data?.activityType,
  });

  const windowStart = new Date(
    now.getTime() - NOTIFICATION_DEDUP_WINDOW_MINUTES * 60 * 1000
  );

  const existing = await prisma.notification.findMany({
    where: {
      userId: { in: targets },
      type: payload.type,
      senderId: payload.senderId,
      videoId: payload.videoId,
      createdAt: { gte: windowStart },
    },
    select: {
      userId: true,
      data: true,
    },
  });

  const alreadyNotifiedUsers = new Set();
  for (const row of existing) {
    const existingKey = buildDedupKey({
      type: payload.type,
      senderId: payload.senderId,
      videoId: payload.videoId,
      activityType: row?.data?.activityType,
    });
    if (existingKey === dedupKey) {
      alreadyNotifiedUsers.add(row.userId);
    }
  }

  const finalTargets = targets.filter((userId) => !alreadyNotifiedUsers.has(userId));

  return {
    finalTargets,
    skippedByDedup: targets.length - finalTargets.length,
  };
};

export const dispatchChannelActivityNotification = async ({
  channelId,
  senderId,
  activityType,
  title,
  message,
  audience = CHANNEL_ACTIVITY_AUDIENCE.ALL_AND_PERSONALIZED,
  videoId = null,
  extraData = {},
}) => {
  if (!channelId) return { sent: 0 };

  const payload = normalizeActivityPayload({
    activityType,
    channelId,
    senderId,
    title,
    message,
    videoId,
    extraData,
  });

  if (!payload.title || !payload.message) {
    return { sent: 0 };
  }

  const allowedLevels = resolveAllowedBellLevels(audience);

  const subscriptions = await prisma.subscription.findMany({
    where: {
      channelId,
      notificationLevel: {
        in: allowedLevels,
      },
    },
    select: {
      subscriberId: true,
      subscriber: {
        select: {
          settings: {
            select: {
              subscriptionNotifications: true,
            },
          },
        },
      },
    },
  });

  if (!subscriptions.length) return { sent: 0 };

  const targets = subscriptions
    .filter((sub) => sub.subscriberId && sub.subscriberId !== senderId)
    .filter((sub) => sub.subscriber?.settings?.subscriptionNotifications !== false)
    .map((sub) => sub.subscriberId);

  if (!targets.length) return { sent: 0 };

  const now = new Date();

  const { finalTargets, skippedByDedup } = await filterDeduplicatedTargets({
    targets,
    payload,
    now,
  });

  if (!finalTargets.length) {
    return { sent: 0, skippedByDedup };
  }

  const records = finalTargets.map((targetUserId) => ({
    userId: targetUserId,
    title: payload.title,
    message: payload.message,
    type: payload.type,
    senderId: payload.senderId,
    videoId: payload.videoId,
    data: payload.data,
    createdAt: now,
  }));

  await prisma.notification.createMany({ data: records });

  for (const targetUserId of finalTargets) {
    emitToUser(targetUserId, SOCKET_EVENT_NOTIFICATION_NEW, {
      title: payload.title,
      message: payload.message,
      type: payload.type,
      senderId: payload.senderId,
      videoId: payload.videoId,
      data: payload.data,
      createdAt: now.toISOString(),
      requiresSync: true,
    });
  }

  return {
    sent: finalTargets.length,
    skippedByDedup,
  };
};

export const ChannelNotificationAudience = CHANNEL_ACTIVITY_AUDIENCE;
