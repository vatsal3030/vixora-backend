import ApiError from "../utils/ApiError.js";
import { PRIVILEGED_ADMIN_ROLES, TOP_ADMIN_ROLE } from "../config/admin.config.js";

export const RESTORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const USER_ROLE_RANK = Object.freeze({
  USER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
});

export const REPORT_RESOLVE_STATUSES = new Set(["REVIEWED", "REJECTED", "ACTION_TAKEN"]);

export const ADMIN_ACTION_TYPES = new Set([
  "USER_SET_STATUS",
  "USER_SOFT_DELETE",
  "USER_RESTORE",
  "USER_VERIFY_PENDING_EMAIL",
  "VIDEO_UNPUBLISH",
  "VIDEO_PUBLISH",
  "VIDEO_SOFT_DELETE",
  "VIDEO_RESTORE",
  "TWEET_SOFT_DELETE",
  "TWEET_RESTORE",
  "COMMENT_SOFT_DELETE",
  "COMMENT_RESTORE",
  "PLAYLIST_SOFT_DELETE",
  "PLAYLIST_RESTORE",
]);

export const ADMIN_PERIOD_TO_DAYS = Object.freeze({
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
});

export const buildAdminPermissions = (role) => {
  const common = [
    "ADMIN_READ_ME",
    "ADMIN_DASHBOARD_READ",
    "REPORT_READ",
    "REPORT_RESOLVE",
    "VIDEO_MODERATE",
    "TWEET_MODERATE",
    "COMMENT_MODERATE",
    "PLAYLIST_MODERATE",
    "AUDIT_READ",
    "USER_READ",
  ];

  if (role === "MODERATOR") {
    return [...common, "USER_SET_RESTRICTED", "USER_SET_ACTIVE"];
  }

  if (role === "ADMIN") {
    return [
      ...common,
      "USER_SET_RESTRICTED",
      "USER_SET_ACTIVE",
      "USER_SET_SUSPENDED",
      "USER_SOFT_DELETE",
      "USER_RESTORE",
      "USER_VERIFY_PENDING_EMAIL",
    ];
  }

  if (role === TOP_ADMIN_ROLE) {
    return [
      ...common,
      "USER_SET_RESTRICTED",
      "USER_SET_ACTIVE",
      "USER_SET_SUSPENDED",
      "USER_SOFT_DELETE",
      "USER_RESTORE",
      "USER_VERIFY_PENDING_EMAIL",
      "USER_ROLE_UPDATE",
    ];
  }

  return common;
};

export const assertWithinRestoreWindow = (deletedAt) => {
  if (!deletedAt) {
    throw new ApiError(400, "Restore metadata missing");
  }

  const expiresAt = new Date(deletedAt.getTime() + RESTORE_WINDOW_MS);
  if (Date.now() > expiresAt.getTime()) {
    throw new ApiError(403, "Restore window expired");
  }
};

export const assertActorCanManageUser = ({ actor, target, allowSelf = false }) => {
  if (!allowSelf && actor.id === target.id) {
    throw new ApiError(400, "This action is not allowed on your own account");
  }

  if (actor.role === TOP_ADMIN_ROLE) return;

  const actorRank = USER_ROLE_RANK[actor.role] || 0;
  const targetRank = USER_ROLE_RANK[target.role] || 0;

  if (targetRank >= actorRank) {
    throw new ApiError(403, "Insufficient permissions for this target user");
  }
};

export const ensureModeratorStatusTransition = ({ actorRole, nextStatus }) => {
  if (actorRole !== "MODERATOR") return;

  if (!["ACTIVE", "RESTRICTED"].includes(nextStatus)) {
    throw new ApiError(403, "Moderators can set status only to ACTIVE or RESTRICTED");
  }
};

export const ensurePrivilegedAdminOrThrow = (role) => {
  if (role === TOP_ADMIN_ROLE) return;
  if (PRIVILEGED_ADMIN_ROLES.has(role)) return;
  throw new ApiError(403, "Insufficient permissions");
};

export const resolvePeriodOrThrow = (rawPeriod, fallback = "7d") => {
  const period = String(rawPeriod || fallback).trim().toLowerCase();
  const days = ADMIN_PERIOD_TO_DAYS[period];
  if (!days) {
    throw new ApiError(400, "Invalid period. Allowed: 7d, 30d, 90d, 1y");
  }
  return { period, days };
};

export const buildRangeForDays = (days) => {
  const now = new Date();
  const end = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
};
