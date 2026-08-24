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

/**
 * Records user activity log in DB asynchronously.
 * Dedupes frequent actions (e.g., repeated watch ping for same video within 5 minutes).
 */
export const recordUserActivity = async ({
  req,
  userId,
  action,
  targetType = null,
  targetId = null,
  metadata = null,
  dedupeMinutes = 5,
}) => {
  if (!userId || !action) return null;

  try {
    const safeAction = String(action).toUpperCase().trim();
    const safeTargetId = targetId ? String(targetId) : null;
    const safeTargetType = targetType ? String(targetType).toUpperCase().trim() : null;

    if (dedupeMinutes > 0 && safeTargetId) {
      const windowStart = new Date(Date.now() - dedupeMinutes * 60 * 1000);
      const existing = await prisma.userActivityLog.findFirst({
        where: {
          userId: String(userId),
          action: safeAction,
          targetId: safeTargetId,
          createdAt: { gte: windowStart },
        },
        select: { id: true },
      });

      if (existing) {
        return null; // Suppress duplicate log within time window
      }
    }

    return await prisma.userActivityLog.create({
      data: {
        userId: String(userId),
        action: safeAction,
        targetType: safeTargetType,
        targetId: safeTargetId,
        metadata: metadata || undefined,
        ip: normalizeIp(req),
        userAgent: trimTo(req?.headers?.["user-agent"], 500),
      },
    });
  } catch (error) {
    // Non-blocking for user requests
    console.warn("User activity log write notice:", error?.message || error);
    return null;
  }
};
