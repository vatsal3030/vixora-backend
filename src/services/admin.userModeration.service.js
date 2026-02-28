import prisma from "../db/prisma.js";
import ApiError from "../utils/ApiError.js";
import { writeAdminAuditLog } from "./admin.audit.service.js";
import { adminBaseUserSelect } from "./admin.selects.js";
import {
  assertActorCanManageUser,
  assertWithinRestoreWindow,
  ensureModeratorStatusTransition,
  ensurePrivilegedAdminOrThrow,
} from "./admin.policy.service.js";

export const runAdminUserStatusUpdate = async ({ req, actor, userId, status, reason }) => {
  const nextStatus = String(status || "").trim().toUpperCase();
  if (!["ACTIVE", "RESTRICTED", "SUSPENDED"].includes(nextStatus)) {
    throw new ApiError(400, "Invalid moderation status");
  }

  if (!String(reason || "").trim()) {
    throw new ApiError(400, "reason is required");
  }

  ensureModeratorStatusTransition({ actorRole: actor.role, nextStatus });

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...adminBaseUserSelect,
    },
  });

  if (!target) throw new ApiError(404, "User not found");
  if (target.isDeleted) throw new ApiError(400, "Cannot change status for deleted user");

  assertActorCanManageUser({ actor, target, allowSelf: false });

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      moderationStatus: nextStatus,
      moderationReason: reason,
      moderatedAt: new Date(),
      moderatedById: actor.id,
    },
    select: {
      ...adminBaseUserSelect,
    },
  });

  await writeAdminAuditLog({
    req,
    actor,
    action: "ADMIN_USER_STATUS_UPDATE",
    targetType: "USER",
    targetId: target.id,
    reason,
    before: {
      moderationStatus: target.moderationStatus,
      moderationReason: target.moderationReason,
      moderatedAt: target.moderatedAt,
      moderatedById: target.moderatedById,
    },
    after: {
      moderationStatus: updated.moderationStatus,
      moderationReason: updated.moderationReason,
      moderatedAt: updated.moderatedAt,
      moderatedById: updated.moderatedById,
    },
  });

  return updated;
};

export const runAdminUserSoftDelete = async ({ req, actor, userId, reason }) => {
  ensurePrivilegedAdminOrThrow(actor.role);

  if (!String(reason || "").trim()) {
    throw new ApiError(400, "reason is required");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...adminBaseUserSelect,
    },
  });

  if (!target) throw new ApiError(404, "User not found");
  if (target.isDeleted) throw new ApiError(400, "User already deleted");

  assertActorCanManageUser({ actor, target, allowSelf: false });

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      refreshToken: null,
      moderationStatus: "SUSPENDED",
      moderationReason: reason,
      moderatedAt: new Date(),
      moderatedById: actor.id,
    },
    select: {
      ...adminBaseUserSelect,
    },
  });

  await writeAdminAuditLog({
    req,
    actor,
    action: "ADMIN_USER_SOFT_DELETE",
    targetType: "USER",
    targetId: target.id,
    reason,
    before: {
      isDeleted: target.isDeleted,
      deletedAt: target.deletedAt,
      moderationStatus: target.moderationStatus,
    },
    after: {
      isDeleted: updated.isDeleted,
      deletedAt: updated.deletedAt,
      moderationStatus: updated.moderationStatus,
    },
  });

  return updated;
};

export const runAdminUserRestore = async ({ req, actor, userId, reason }) => {
  ensurePrivilegedAdminOrThrow(actor.role);

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...adminBaseUserSelect,
    },
  });

  if (!target) throw new ApiError(404, "User not found");
  if (!target.isDeleted) throw new ApiError(400, "User is not deleted");

  assertActorCanManageUser({ actor, target, allowSelf: false });
  assertWithinRestoreWindow(target.deletedAt);

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      isDeleted: false,
      deletedAt: null,
      moderationStatus: "ACTIVE",
      moderationReason: reason || null,
      moderatedAt: new Date(),
      moderatedById: actor.id,
    },
    select: {
      ...adminBaseUserSelect,
    },
  });

  await writeAdminAuditLog({
    req,
    actor,
    action: "ADMIN_USER_RESTORE",
    targetType: "USER",
    targetId: target.id,
    reason,
    before: {
      isDeleted: target.isDeleted,
      deletedAt: target.deletedAt,
      moderationStatus: target.moderationStatus,
    },
    after: {
      isDeleted: updated.isDeleted,
      deletedAt: updated.deletedAt,
      moderationStatus: updated.moderationStatus,
    },
  });

  return updated;
};

export const runAdminVerifyPendingEmail = async ({ req, actor, userId, reason }) => {
  ensurePrivilegedAdminOrThrow(actor.role);

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isDeleted: true,
      email: true,
      emailVerified: true,
      pendingEmail: true,
      pendingEmailOtpHash: true,
      pendingEmailOtpExpiresAt: true,
    },
  });

  if (!target) throw new ApiError(404, "User not found");
  if (target.isDeleted) throw new ApiError(400, "Cannot verify pending email for deleted user");

  assertActorCanManageUser({ actor, target, allowSelf: false });

  if (!target.pendingEmail) {
    throw new ApiError(400, "No pending email to verify");
  }

  const conflict = await prisma.user.findFirst({
    where: {
      id: { not: target.id },
      email: {
        equals: target.pendingEmail,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (conflict) {
    throw new ApiError(409, "Pending email is already in use");
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      email: target.pendingEmail,
      emailVerified: true,
      pendingEmail: null,
      pendingEmailOtpHash: null,
      pendingEmailOtpExpiresAt: null,
    },
    select: {
      ...adminBaseUserSelect,
    },
  });

  await writeAdminAuditLog({
    req,
    actor,
    action: "ADMIN_USER_VERIFY_PENDING_EMAIL",
    targetType: "USER",
    targetId: target.id,
    reason,
    before: {
      email: target.email,
      emailVerified: target.emailVerified,
      pendingEmail: target.pendingEmail,
    },
    after: {
      email: updated.email,
      emailVerified: updated.emailVerified,
      pendingEmail: updated.pendingEmail,
    },
  });

  return updated;
};
