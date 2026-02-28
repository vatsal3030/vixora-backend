import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import { ADMIN_ACTION_TYPES } from "./admin.policy.service.js";
import { toUserSummary, normalizeText } from "./admin.controller.utils.js";
import {
  runAdminUserRestore,
  runAdminUserSoftDelete,
  runAdminUserStatusUpdate,
  runAdminVerifyPendingEmail,
} from "./admin.userModeration.service.js";
import {
  runAdminCommentRestore,
  runAdminCommentSoftDelete,
  runAdminPlaylistRestore,
  runAdminPlaylistSoftDelete,
  runAdminTweetRestore,
  runAdminTweetSoftDelete,
  runAdminVideoPublish,
  runAdminVideoRestore,
  runAdminVideoSoftDelete,
  runAdminVideoUnpublish,
} from "./admin.contentModeration.service.js";

export const resolveReportAction = (rawAction, report) => {
  if (!rawAction) return null;

  if (typeof rawAction === "string") {
    return {
      type: normalizeText(rawAction).toUpperCase(),
      targetType: report.targetType,
      targetId: report.targetId,
      payload: {},
    };
  }

  if (typeof rawAction === "object") {
    const type = normalizeText(rawAction.type).toUpperCase();
    if (!type) {
      throw new ApiError(400, "action.type is required");
    }

    return {
      type,
      targetType: normalizeText(rawAction.targetType || report.targetType).toUpperCase(),
      targetId: normalizeText(rawAction.targetId || report.targetId),
      payload: rawAction.payload && typeof rawAction.payload === "object" ? rawAction.payload : {},
    };
  }

  throw new ApiError(400, "Invalid action format");
};

export const buildReportTargetSnapshot = async ({ targetType, targetId }) => {
  if (!targetType || !targetId) return null;

  if (targetType === "VIDEO") {
    const row = await prisma.video.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        title: true,
        isShort: true,
        isDeleted: true,
        isPublished: true,
        owner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatar: true,
            role: true,
          },
        },
      },
    });

    return row
      ? {
          type: "VIDEO",
          id: row.id,
          title: row.title,
          isShort: row.isShort,
          isDeleted: row.isDeleted,
          isPublished: row.isPublished,
          owner: toUserSummary(row.owner),
        }
      : null;
  }

  if (targetType === "COMMENT") {
    const row = await prisma.comment.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        content: true,
        isDeleted: true,
        videoId: true,
        owner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatar: true,
            role: true,
          },
        },
      },
    });

    return row
      ? {
          type: "COMMENT",
          id: row.id,
          content: row.content,
          videoId: row.videoId,
          isDeleted: row.isDeleted,
          owner: toUserSummary(row.owner),
        }
      : null;
  }

  if (targetType === "USER" || targetType === "CHANNEL") {
    const row = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        fullName: true,
        username: true,
        avatar: true,
        email: true,
        role: true,
        moderationStatus: true,
        isDeleted: true,
      },
    });

    return row
      ? {
          type: targetType,
          id: row.id,
          fullName: row.fullName,
          username: row.username,
          avatar: row.avatar,
          email: row.email,
          role: row.role,
          moderationStatus: row.moderationStatus,
          isDeleted: row.isDeleted,
        }
      : null;
  }

  return null;
};

export const hydrateReportTargets = async (rows) => {
  if (!rows?.length) return [];

  const grouped = {
    VIDEO: new Set(),
    COMMENT: new Set(),
    USER: new Set(),
    CHANNEL: new Set(),
  };

  for (const row of rows) {
    if (!row?.targetType || !row?.targetId) continue;
    if (!grouped[row.targetType]) continue;
    grouped[row.targetType].add(row.targetId);
  }

  const [videos, comments, users] = await Promise.all([
    grouped.VIDEO.size
      ? prisma.video.findMany({
          where: { id: { in: [...grouped.VIDEO] } },
          select: {
            id: true,
            title: true,
            isShort: true,
            isDeleted: true,
            isPublished: true,
            owner: {
              select: {
                id: true,
                fullName: true,
                username: true,
                avatar: true,
                role: true,
              },
            },
          },
        })
      : [],
    grouped.COMMENT.size
      ? prisma.comment.findMany({
          where: { id: { in: [...grouped.COMMENT] } },
          select: {
            id: true,
            content: true,
            videoId: true,
            isDeleted: true,
            owner: {
              select: {
                id: true,
                fullName: true,
                username: true,
                avatar: true,
                role: true,
              },
            },
          },
        })
      : [],
    grouped.USER.size || grouped.CHANNEL.size
      ? prisma.user.findMany({
          where: { id: { in: [...new Set([...grouped.USER, ...grouped.CHANNEL])] } },
          select: {
            id: true,
            fullName: true,
            username: true,
            avatar: true,
            email: true,
            role: true,
            moderationStatus: true,
            isDeleted: true,
          },
        })
      : [],
  ]);

  const videoMap = new Map(videos.map((row) => [row.id, row]));
  const commentMap = new Map(comments.map((row) => [row.id, row]));
  const userMap = new Map(users.map((row) => [row.id, row]));

  return rows.map((report) => {
    let target = null;

    if (report.targetType === "VIDEO") {
      const row = videoMap.get(report.targetId);
      target = row
        ? {
            type: "VIDEO",
            id: row.id,
            title: row.title,
            isShort: row.isShort,
            isDeleted: row.isDeleted,
            isPublished: row.isPublished,
            owner: toUserSummary(row.owner),
          }
        : null;
    } else if (report.targetType === "COMMENT") {
      const row = commentMap.get(report.targetId);
      target = row
        ? {
            type: "COMMENT",
            id: row.id,
            content: row.content,
            videoId: row.videoId,
            isDeleted: row.isDeleted,
            owner: toUserSummary(row.owner),
          }
        : null;
    } else if (report.targetType === "USER" || report.targetType === "CHANNEL") {
      const row = userMap.get(report.targetId);
      target = row
        ? {
            type: report.targetType,
            id: row.id,
            fullName: row.fullName,
            username: row.username,
            avatar: row.avatar,
            email: row.email,
            role: row.role,
            moderationStatus: row.moderationStatus,
            isDeleted: row.isDeleted,
          }
        : null;
    }

    return {
      ...report,
      reporter: toUserSummary(report.reporter),
      resolvedBy: toUserSummary(report.resolvedBy),
      target,
    };
  });
};

export const executeAdminAction = async ({ req, actor, action, fallbackTarget }) => {
  if (!action) return null;
  if (!ADMIN_ACTION_TYPES.has(action.type)) {
    throw new ApiError(400, `Unsupported action type: ${action.type}`);
  }

  const targetId = action.targetId || fallbackTarget?.targetId;
  if (!targetId) {
    throw new ApiError(400, "Action targetId is required");
  }

  const payload = action.payload || {};

  switch (action.type) {
    case "USER_SET_STATUS":
      return runAdminUserStatusUpdate({
        req,
        actor,
        userId: targetId,
        status: payload.status,
        reason: payload.reason || payload.note || fallbackTarget?.reason || "Status updated by admin",
      });
    case "USER_SOFT_DELETE":
      return runAdminUserSoftDelete({
        req,
        actor,
        userId: targetId,
        reason: payload.reason || fallbackTarget?.reason || "Soft deleted by admin",
      });
    case "USER_RESTORE":
      return runAdminUserRestore({
        req,
        actor,
        userId: targetId,
        reason: payload.reason || fallbackTarget?.reason || null,
      });
    case "USER_VERIFY_PENDING_EMAIL":
      return runAdminVerifyPendingEmail({
        req,
        actor,
        userId: targetId,
        reason: payload.reason || fallbackTarget?.reason || null,
      });
    case "VIDEO_UNPUBLISH":
      return runAdminVideoUnpublish({
        req,
        actor,
        videoId: targetId,
        reason: payload.reason || fallbackTarget?.reason || null,
      });
    case "VIDEO_PUBLISH":
      return runAdminVideoPublish({
        req,
        actor,
        videoId: targetId,
        reason: payload.reason || fallbackTarget?.reason || null,
      });
    case "VIDEO_SOFT_DELETE":
      return runAdminVideoSoftDelete({
        req,
        actor,
        videoId: targetId,
        reason: payload.reason || fallbackTarget?.reason || "Soft deleted by admin",
      });
    case "VIDEO_RESTORE":
      return runAdminVideoRestore({
        req,
        actor,
        videoId: targetId,
        reason: payload.reason || fallbackTarget?.reason || null,
      });
    case "TWEET_SOFT_DELETE":
      return runAdminTweetSoftDelete({
        req,
        actor,
        tweetId: targetId,
        reason: payload.reason || fallbackTarget?.reason || "Soft deleted by admin",
      });
    case "TWEET_RESTORE":
      return runAdminTweetRestore({
        req,
        actor,
        tweetId: targetId,
        reason: payload.reason || fallbackTarget?.reason || null,
      });
    case "COMMENT_SOFT_DELETE":
      return runAdminCommentSoftDelete({
        req,
        actor,
        commentId: targetId,
        reason: payload.reason || fallbackTarget?.reason || "Soft deleted by admin",
      });
    case "COMMENT_RESTORE":
      return runAdminCommentRestore({
        req,
        actor,
        commentId: targetId,
        reason: payload.reason || fallbackTarget?.reason || null,
      });
    case "PLAYLIST_SOFT_DELETE":
      return runAdminPlaylistSoftDelete({
        req,
        actor,
        playlistId: targetId,
        reason: payload.reason || fallbackTarget?.reason || "Soft deleted by admin",
      });
    case "PLAYLIST_RESTORE":
      return runAdminPlaylistRestore({
        req,
        actor,
        playlistId: targetId,
        reason: payload.reason || fallbackTarget?.reason || null,
      });
    default:
      throw new ApiError(400, `Unsupported action type: ${action.type}`);
  }
};
