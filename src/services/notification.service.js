import prisma from "../db/prisma.js";
import { emitToUser } from "../realtime/socket.server.js";

const CHANNEL_ACTIVITY_AUDIENCE = {
  ALL_ONLY: "ALL_ONLY",
  ALL_AND_PERSONALIZED: "ALL_AND_PERSONALIZED",
};

const SOCKET_EVENT_NOTIFICATION_NEW = "notification:new";

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
  const records = targets.map((targetUserId) => ({
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

  for (const targetUserId of targets) {
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

  return { sent: targets.length };
};

export const ChannelNotificationAudience = CHANNEL_ACTIVITY_AUDIENCE;

