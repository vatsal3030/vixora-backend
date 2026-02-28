import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import {
  ADMIN_ROLES,
  isAdminPanelEnabled,
  TOP_ADMIN_ROLE,
} from "../config/admin.config.js";

const SAFE_WRITE_PATHS_FOR_RESTRICTED_USERS = new Set([
  "/api/v1/users/logout",
  "/api/v1/users/switch-account",
  "/api/v1/users/switch-account/resolve",
]);

const isWriteMethod = (method) => !["GET", "HEAD", "OPTIONS"].includes(String(method || "").toUpperCase());

const normalizePath = (path) => {
  const raw = String(path || "").split("?")[0].trim();
  if (!raw) return raw;
  return raw.endsWith("/") && raw.length > 1 ? raw.slice(0, -1) : raw;
};

export const ensureAdminPanelEnabled = (req, res, next) => {
  if (isAdminPanelEnabled()) {
    return next();
  }

  return res.status(404).json({
    success: false,
    message: "Route not found",
  });
};

export const verifyAdmin = asyncHandler(async (req, _res, next) => {
  if (!req.user?.id) {
    throw new ApiError(401, "Unauthorized");
  }

  if (!isAdminPanelEnabled()) {
    throw new ApiError(404, "Route not found");
  }

  if (req.user.isDeleted) {
    throw new ApiError(403, "Account deleted");
  }

  if (req.user.moderationStatus === "SUSPENDED") {
    throw new ApiError(403, "Admin account suspended");
  }

  if (!ADMIN_ROLES.has(req.user.role)) {
    throw new ApiError(403, "Admin access required");
  }

  next();
});

export const requireAdminRole = (...roles) => {
  const allowed = new Set((roles || []).filter(Boolean));
  return (req, _res, next) => {
    if (!req.user?.role) {
      throw new ApiError(401, "Unauthorized");
    }

    if (allowed.size > 0 && !allowed.has(req.user.role)) {
      throw new ApiError(403, "Insufficient admin permissions");
    }

    return next();
  };
};

export const ensureNotLastSuperAdminDemotion = async ({
  actorId,
  targetUserId,
  targetCurrentRole,
  nextRole,
  countSuperAdmins,
}) => {
  if (targetCurrentRole !== TOP_ADMIN_ROLE) return;
  if (nextRole === TOP_ADMIN_ROLE) return;
  if (countSuperAdmins > 1) return;
  if (actorId === targetUserId) {
    throw new ApiError(400, "You cannot demote the last SUPER_ADMIN");
  }
  throw new ApiError(400, "Cannot demote the last SUPER_ADMIN");
};

export const writeAccessGuard = asyncHandler(async (req, _res, next) => {
  if (!req.user?.id) {
    return next();
  }

  if (!isWriteMethod(req.method)) {
    return next();
  }

  // Admin users are managed by admin middleware and are not subject to
  // end-user write restrictions.
  if (ADMIN_ROLES.has(req.user.role)) {
    return next();
  }

  if (!["RESTRICTED", "SUSPENDED"].includes(req.user.moderationStatus || "")) {
    return next();
  }

  const path = normalizePath(req.originalUrl || req.path);
  if (SAFE_WRITE_PATHS_FOR_RESTRICTED_USERS.has(path)) {
    return next();
  }

  throw new ApiError(
    403,
    "Your account is currently restricted. Read-only access is allowed."
  );
});
