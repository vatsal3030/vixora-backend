import prisma from "../db/prisma.js";
import { emitToUser } from "../realtime/socket.server.js";

const CHANNEL_ACTIVITY_AUDIENCE = {
  ALL_ONLY: "ALL_ONLY",
  ALL_AND_PERSONALIZED: "ALL_AND_PERSONALIZED",
};

const SOCKET_EVENT_NOTIFICATION_NEW = "notification:new";
const DEFAULT_NOTIFICATION_DEDUP_WINDOW_MINUTES = 30;
const DEFAULT_CHANNEL_NAME = "A channel you follow";

const parsePositiveInt = (value, fallbackValue) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallbackValue;
  return parsed;
};

const normalizeText = (value) => String(value ?? "").trim();

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const truncateText = (value, maxLength = 120) => {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(maxLength - 3, 1)).trim()}...`;
};

const uniqueNonEmpty = (values) => {
  const output = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
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

const createTarget = ({ type, id = null, url = null, fallbackUrls = [] }) => {
  const normalizedType = normalizeText(type).toUpperCase() || "SYSTEM";
  const normalizedId = normalizeText(id) || null;
  const allUrls = uniqueNonEmpty([url, ...fallbackUrls]);
  const primaryUrl = allUrls[0] || null;

  return {
    type: normalizedType,
    id: normalizedId,
    url: primaryUrl,
    fallbackUrls: allUrls.slice(1),
    isClickable: Boolean(primaryUrl),
  };
};

const resolveActivityType = (value) => normalizeText(value).toUpperCase() || "CHANNEL_ACTIVITY";

const resolveChannelName = ({ extraData }) => {
  const name = normalizeText(
    extraData?.channelName ||
      extraData?.senderName ||
      extraData?.authorName ||
      extraData?.channelDisplayName
  );
  return name || DEFAULT_CHANNEL_NAME;
};

const resolveTargetFromActivity = ({
  activityType,
  channelId,
  senderId,
  videoId,
  extraData,
}) => {
  const resolvedActivityType = resolveActivityType(activityType);
  const resolvedVideoId = normalizeText(videoId || extraData?.videoId) || null;
  const resolvedTweetId = normalizeText(extraData?.tweetId || extraData?.postId) || null;
  const resolvedCommentId = normalizeText(extraData?.commentId) || null;
  const resolvedPlaylistId = normalizeText(extraData?.playlistId) || null;
  const resolvedChannelId = normalizeText(channelId || senderId || extraData?.channelId) || null;

  if (resolvedActivityType === "SHORT_PUBLISHED" && resolvedVideoId) {
    return createTarget({
      type: "SHORT",
      id: resolvedVideoId,
      url: `/watch/${resolvedVideoId}`,
      fallbackUrls: [`/videos/${resolvedVideoId}`],
    });
  }

  if (
    (resolvedActivityType === "VIDEO_PUBLISHED" ||
      resolvedActivityType === "VIDEO_UPDATED") &&
    resolvedVideoId
  ) {
    return createTarget({
      type: "VIDEO",
      id: resolvedVideoId,
      url: `/watch/${resolvedVideoId}`,
      fallbackUrls: [`/videos/${resolvedVideoId}`],
    });
  }

  if (resolvedActivityType === "POST_CREATED" && resolvedTweetId) {
    return createTarget({
      type: "TWEET",
      id: resolvedTweetId,
      url: `/tweets/${resolvedTweetId}`,
    });
  }

  if (resolvedCommentId && resolvedVideoId) {
    return createTarget({
      type: "COMMENT",
      id: resolvedCommentId,
      url: `/watch/${resolvedVideoId}?comment=${resolvedCommentId}`,
      fallbackUrls: [`/watch/${resolvedVideoId}`],
    });
  }

  if (resolvedTweetId) {
    return createTarget({
      type: "TWEET",
      id: resolvedTweetId,
      url: `/tweets/${resolvedTweetId}`,
    });
  }

  if (resolvedVideoId) {
    return createTarget({
      type: "VIDEO",
      id: resolvedVideoId,
      url: `/watch/${resolvedVideoId}`,
      fallbackUrls: [`/videos/${resolvedVideoId}`],
    });
  }

  if (resolvedPlaylistId) {
    return createTarget({
      type: "PLAYLIST",
      id: resolvedPlaylistId,
      url: `/playlists/${resolvedPlaylistId}`,
    });
  }

  if (resolvedChannelId) {
    return createTarget({
      type: "CHANNEL",
      id: resolvedChannelId,
      url: `/channels/${resolvedChannelId}`,
      fallbackUrls: [`/channel/${resolvedChannelId}`],
    });
  }

  return createTarget({ type: "SYSTEM" });
};

const buildActivityCopy = ({
  activityType,
  channelName,
  title,
  message,
  extraData,
}) => {
  const resolvedActivityType = resolveActivityType(activityType);
  const safeChannelName = normalizeText(channelName) || DEFAULT_CHANNEL_NAME;
  const videoTitle = normalizeText(extraData?.videoTitle || extraData?.title);
  const tweetPreview = truncateText(
    extraData?.tweetPreview || extraData?.tweetText || extraData?.content,
    90
  );
  const fallbackTitle = normalizeText(title);
  const fallbackMessage = normalizeText(message);

  if (resolvedActivityType === "VIDEO_PUBLISHED") {
    return {
      title: `New video from ${safeChannelName}`,
      message: videoTitle
        ? `${safeChannelName} uploaded: ${videoTitle}`
        : fallbackMessage || `${safeChannelName} uploaded a new video.`,
    };
  }

  if (resolvedActivityType === "SHORT_PUBLISHED") {
    return {
      title: `New Short from ${safeChannelName}`,
      message: videoTitle
        ? `${safeChannelName} uploaded a Short: ${videoTitle}`
        : fallbackMessage || `${safeChannelName} uploaded a new Short.`,
    };
  }

  if (resolvedActivityType === "VIDEO_UPDATED") {
    return {
      title: `Video updated by ${safeChannelName}`,
      message: videoTitle
        ? `${safeChannelName} updated: ${videoTitle}`
        : fallbackMessage || `${safeChannelName} updated a video.`,
    };
  }

  if (resolvedActivityType === "POST_CREATED") {
    return {
      title: `New post from ${safeChannelName}`,
      message: tweetPreview
        ? `${safeChannelName} posted: ${tweetPreview}`
        : fallbackMessage || `${safeChannelName} shared a new post.`,
    };
  }

  return {
    title: fallbackTitle || `Update from ${safeChannelName}`,
    message: fallbackMessage || `${safeChannelName} shared a new update.`,
  };
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
  const safeExtraData = isPlainObject(extraData) ? extraData : {};
  const resolvedActivityType = resolveActivityType(activityType);
  const resolvedSenderId = normalizeText(senderId || channelId) || null;
  const resolvedChannelId = normalizeText(channelId || senderId || safeExtraData.channelId) || null;
  const resolvedChannelName = resolveChannelName({ extraData: safeExtraData });
  const target = resolveTargetFromActivity({
    activityType: resolvedActivityType,
    channelId: resolvedChannelId,
    senderId: resolvedSenderId,
    videoId,
    extraData: safeExtraData,
  });
  const copy = buildActivityCopy({
    activityType: resolvedActivityType,
    channelName: resolvedChannelName,
    title,
    message,
    extraData: safeExtraData,
  });
  const resolvedVideoId =
    normalizeText(
      videoId ||
        safeExtraData.videoId ||
        (target.type === "VIDEO" || target.type === "SHORT" ? target.id : "")
    ) || null;

  return {
    type: "UPLOAD",
    title: copy.title,
    message: copy.message,
    senderId: resolvedSenderId,
    videoId: resolvedVideoId,
    data: {
      ...safeExtraData,
      activityType: resolvedActivityType,
      channelId: resolvedChannelId,
      channelName: resolvedChannelName,
      targetType: target.type || null,
      targetId: target.id || null,
      targetUrl: target.url || null,
      target,
    },
  };
};

const resolveDedupTargetId = (data) => {
  if (!isPlainObject(data)) return "";
  return normalizeText(
    data.targetId ||
      data?.target?.id ||
      data.videoId ||
      data.tweetId ||
      data.commentId ||
      data.playlistId
  );
};

const buildDedupKey = ({ type, senderId, videoId, activityType, targetId }) => {
  return [
    String(type || "").trim().toUpperCase(),
    String(senderId || "").trim(),
    String(videoId || "").trim(),
    String(activityType || "").trim().toUpperCase(),
    String(targetId || "").trim(),
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
    targetId: resolveDedupTargetId(payload.data),
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
      targetId: resolveDedupTargetId(row?.data),
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
      target: payload.data?.target || null,
      targetType: payload.data?.targetType || null,
      targetId: payload.data?.targetId || null,
      targetUrl: payload.data?.targetUrl || null,
      isClickable: Boolean(payload.data?.target?.isClickable),
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
