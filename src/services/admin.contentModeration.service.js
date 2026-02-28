import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import { writeAdminAuditLog } from "./admin.audit.service.js";
import { assertWithinRestoreWindow } from "./admin.policy.service.js";

export const runAdminVideoUnpublish = async ({ req, actor, videoId, reason }) => {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      isPublished: true,
      isDeleted: true,
      ownerId: true,
    },
  });

  if (!video) throw new ApiError(404, "Video not found");
  if (video.isDeleted) throw new ApiError(400, "Video is deleted");

  const updated = await prisma.video.update({
    where: { id: video.id },
    data: { isPublished: false },
    select: {
      id: true,
      title: true,
      isPublished: true,
      isDeleted: true,
      ownerId: true,
      updatedAt: true,
    },
  });

  await writeAdminAuditLog({
    req,
    actor,
    action: "ADMIN_VIDEO_UNPUBLISH",
    targetType: "VIDEO",
    targetId: video.id,
    reason,
    before: { isPublished: video.isPublished, isDeleted: video.isDeleted },
    after: { isPublished: updated.isPublished, isDeleted: updated.isDeleted },
  });

  return updated;
};

export const runAdminVideoPublish = async ({ req, actor, videoId, reason }) => {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      isPublished: true,
      isDeleted: true,
      processingStatus: true,
      isHlsReady: true,
      ownerId: true,
    },
  });

  if (!video) throw new ApiError(404, "Video not found");
  if (video.isDeleted) throw new ApiError(400, "Video is deleted");
  if (video.processingStatus !== "COMPLETED" || !video.isHlsReady) {
    throw new ApiError(400, "Video processing is not completed");
  }

  const updated = await prisma.video.update({
    where: { id: video.id },
    data: { isPublished: true },
    select: {
      id: true,
      title: true,
      isPublished: true,
      isDeleted: true,
      ownerId: true,
      updatedAt: true,
    },
  });

  await writeAdminAuditLog({
    req,
    actor,
    action: "ADMIN_VIDEO_PUBLISH",
    targetType: "VIDEO",
    targetId: video.id,
    reason,
    before: { isPublished: video.isPublished, isDeleted: video.isDeleted },
    after: { isPublished: updated.isPublished, isDeleted: updated.isDeleted },
  });

  return updated;
};

export const runAdminVideoSoftDelete = async ({ req, actor, videoId, reason }) => {
  if (!String(reason || "").trim()) throw new ApiError(400, "reason is required");

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      isPublished: true,
      isDeleted: true,
      deletedAt: true,
      ownerId: true,
    },
  });

  if (!video) throw new ApiError(404, "Video not found");
  if (video.isDeleted) throw new ApiError(400, "Video already deleted");

  const updated = await prisma.video.update({
    where: { id: video.id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      isPublished: false,
    },
    select: {
      id: true,
      title: true,
      isPublished: true,
      isDeleted: true,
      deletedAt: true,
      ownerId: true,
      updatedAt: true,
    },
  });

  await writeAdminAuditLog({
    req,
    actor,
    action: "ADMIN_VIDEO_SOFT_DELETE",
    targetType: "VIDEO",
    targetId: video.id,
    reason,
    before: {
      isPublished: video.isPublished,
      isDeleted: video.isDeleted,
      deletedAt: video.deletedAt,
    },
    after: {
      isPublished: updated.isPublished,
      isDeleted: updated.isDeleted,
      deletedAt: updated.deletedAt,
    },
  });

  return updated;
};

export const runAdminVideoRestore = async ({ req, actor, videoId, reason }) => {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      isPublished: true,
      isDeleted: true,
      deletedAt: true,
      ownerId: true,
    },
  });

  if (!video) throw new ApiError(404, "Video not found");
  if (!video.isDeleted) throw new ApiError(400, "Video is not deleted");

  assertWithinRestoreWindow(video.deletedAt);

  const updated = await prisma.video.update({
    where: { id: video.id },
    data: {
      isDeleted: false,
      deletedAt: null,
      isPublished: false,
    },
    select: {
      id: true,
      title: true,
      isPublished: true,
      isDeleted: true,
      deletedAt: true,
      ownerId: true,
      updatedAt: true,
    },
  });

  await writeAdminAuditLog({
    req,
    actor,
    action: "ADMIN_VIDEO_RESTORE",
    targetType: "VIDEO",
    targetId: video.id,
    reason,
    before: {
      isPublished: video.isPublished,
      isDeleted: video.isDeleted,
      deletedAt: video.deletedAt,
    },
    after: {
      isPublished: updated.isPublished,
      isDeleted: updated.isDeleted,
      deletedAt: updated.deletedAt,
    },
  });

  return updated;
};

const runSoftDeleteForEntity = async ({ req, actor, modelName, id, reason, label }) => {
  if (!String(reason || "").trim()) throw new ApiError(400, "reason is required");

  const model = prisma[modelName];
  const row = await model.findUnique({
    where: { id },
    select: {
      id: true,
      isDeleted: true,
      deletedAt: true,
      ownerId: true,
      content: true,
      name: true,
      title: true,
    },
  });

  if (!row) throw new ApiError(404, `${label} not found`);
  if (row.isDeleted) throw new ApiError(400, `${label} already deleted`);

  const updated = await model.update({
    where: { id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
    },
    select: {
      id: true,
      isDeleted: true,
      deletedAt: true,
      ownerId: true,
      content: true,
      name: true,
      title: true,
      updatedAt: true,
    },
  });

  await writeAdminAuditLog({
    req,
    actor,
    action: `ADMIN_${label.toUpperCase()}_SOFT_DELETE`,
    targetType: label.toUpperCase(),
    targetId: id,
    reason,
    before: { isDeleted: row.isDeleted, deletedAt: row.deletedAt },
    after: { isDeleted: updated.isDeleted, deletedAt: updated.deletedAt },
  });

  return updated;
};

const runRestoreForEntity = async ({ req, actor, modelName, id, reason, label }) => {
  const model = prisma[modelName];
  const row = await model.findUnique({
    where: { id },
    select: {
      id: true,
      isDeleted: true,
      deletedAt: true,
      ownerId: true,
      content: true,
      name: true,
      title: true,
    },
  });

  if (!row) throw new ApiError(404, `${label} not found`);
  if (!row.isDeleted) throw new ApiError(400, `${label} is not deleted`);

  assertWithinRestoreWindow(row.deletedAt);

  const updated = await model.update({
    where: { id },
    data: {
      isDeleted: false,
      deletedAt: null,
    },
    select: {
      id: true,
      isDeleted: true,
      deletedAt: true,
      ownerId: true,
      content: true,
      name: true,
      title: true,
      updatedAt: true,
    },
  });

  await writeAdminAuditLog({
    req,
    actor,
    action: `ADMIN_${label.toUpperCase()}_RESTORE`,
    targetType: label.toUpperCase(),
    targetId: id,
    reason,
    before: { isDeleted: row.isDeleted, deletedAt: row.deletedAt },
    after: { isDeleted: updated.isDeleted, deletedAt: updated.deletedAt },
  });

  return updated;
};

export const runAdminTweetSoftDelete = async ({ req, actor, tweetId, reason }) =>
  runSoftDeleteForEntity({
    req,
    actor,
    modelName: "tweet",
    id: tweetId,
    reason,
    label: "tweet",
  });

export const runAdminTweetRestore = async ({ req, actor, tweetId, reason }) =>
  runRestoreForEntity({
    req,
    actor,
    modelName: "tweet",
    id: tweetId,
    reason,
    label: "tweet",
  });

export const runAdminCommentSoftDelete = async ({ req, actor, commentId, reason }) =>
  runSoftDeleteForEntity({
    req,
    actor,
    modelName: "comment",
    id: commentId,
    reason,
    label: "comment",
  });

export const runAdminCommentRestore = async ({ req, actor, commentId, reason }) =>
  runRestoreForEntity({
    req,
    actor,
    modelName: "comment",
    id: commentId,
    reason,
    label: "comment",
  });

export const runAdminPlaylistSoftDelete = async ({ req, actor, playlistId, reason }) =>
  runSoftDeleteForEntity({
    req,
    actor,
    modelName: "playlist",
    id: playlistId,
    reason,
    label: "playlist",
  });

export const runAdminPlaylistRestore = async ({ req, actor, playlistId, reason }) =>
  runRestoreForEntity({
    req,
    actor,
    modelName: "playlist",
    id: playlistId,
    reason,
    label: "playlist",
  });
