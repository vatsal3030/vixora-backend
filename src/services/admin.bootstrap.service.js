import prisma from "../db/prisma.js";
import {
  ADMIN_ROLES,
  parseAdminBootstrapEmails,
  setAdminPanelEnabled,
} from "../config/admin.config.js";

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

const parseBool = (value, defaultValue = false) => {
  const normalized = cleanEnv(value).toLowerCase();
  if (!normalized) return defaultValue;
  return ["1", "true", "yes", "on"].includes(normalized);
};

const hasExplicitAdminPanelFlag = () =>
  cleanEnv(process.env.ADMIN_PANEL_ENABLED) !== "";

export const bootstrapAdminUsers = async () => {
  const bootstrapEmails = parseAdminBootstrapEmails();
  let promotedCount = 0;

  if (bootstrapEmails.length > 0) {
    const candidates = await prisma.user.findMany({
      where: {
        OR: bootstrapEmails.map((email) => ({
          email: {
            equals: email,
            mode: "insensitive",
          },
        })),
        isDeleted: false,
      },
      select: { id: true },
    });

    const result = await prisma.user.updateMany({
      where: {
        id: {
          in: candidates.map((row) => row.id),
        },
      },
      data: {
        role: "SUPER_ADMIN",
        moderationStatus: "ACTIVE",
        moderationReason: null,
      },
    });
    promotedCount = result.count;
  }

  if (!hasExplicitAdminPanelFlag() && cleanEnv(process.env.NODE_ENV) === "production") {
    const adminCount = await prisma.user.count({
      where: {
        role: {
          in: [...ADMIN_ROLES],
        },
        isDeleted: false,
      },
    });

    // In production, auto-enable only if at least one active admin exists.
    const shouldEnable = adminCount > 0;
    setAdminPanelEnabled(shouldEnable);
  } else if (hasExplicitAdminPanelFlag()) {
    setAdminPanelEnabled(parseBool(process.env.ADMIN_PANEL_ENABLED, true));
  }

  if (promotedCount > 0) {
    console.log(`Admin bootstrap promoted ${promotedCount} user(s) to SUPER_ADMIN.`);
  }
};
