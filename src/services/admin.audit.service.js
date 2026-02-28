import prisma from "../db/prisma.js";

const trimTo = (value, maxLength = 1000) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
};

const normalizeIp = (req) => {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (Array.isArray(forwarded) && forwarded[0]) {
    return trimTo(forwarded[0], 128);
  }

  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0].trim();
    return trimTo(first, 128);
  }

  return trimTo(req?.ip, 128);
};

const sanitizeSnapshot = (value) => {
  if (!value || typeof value !== "object") return value ?? null;
  const clone = JSON.parse(JSON.stringify(value));
  for (const key of [
    "password",
    "refreshToken",
    "otpHash",
    "pendingEmailOtpHash",
    "accessToken",
    "resetToken",
  ]) {
    if (Object.prototype.hasOwnProperty.call(clone, key)) {
      delete clone[key];
    }
  }
  return clone;
};

export const writeAdminAuditLog = async ({
  req,
  actor,
  action,
  targetType,
  targetId = null,
  reason = null,
  before = null,
  after = null,
  metadata = null,
}) => {
  if (!actor?.id || !actor?.role || !action || !targetType) return null;

  try {
    return await prisma.adminAuditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action: String(action).trim(),
        targetType: String(targetType).trim(),
        targetId: targetId ? String(targetId) : null,
        reason: trimTo(reason, 1000),
        before: sanitizeSnapshot(before),
        after: sanitizeSnapshot(after),
        metadata: metadata || undefined,
        ip: normalizeIp(req),
        userAgent: trimTo(req?.headers?.["user-agent"], 500),
      },
    });
  } catch (error) {
    // Audit logging should not break primary admin operation.
    console.error("Admin audit log write failed:", error?.message || error);
    return null;
  }
};
