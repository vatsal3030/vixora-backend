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

const defaultAdminPanelEnabled = cleanEnv(process.env.NODE_ENV) !== "production";
let adminPanelEnabled = parseBool(process.env.ADMIN_PANEL_ENABLED, defaultAdminPanelEnabled);

export const setAdminPanelEnabled = (value) => {
  adminPanelEnabled = Boolean(value);
};

export const isAdminPanelEnabled = () => adminPanelEnabled;

export const parseAdminBootstrapEmails = () => {
  return cleanEnv(process.env.ADMIN_BOOTSTRAP_EMAILS)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

export const ADMIN_ROLES = new Set(["MODERATOR", "ADMIN", "SUPER_ADMIN"]);
export const PRIVILEGED_ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);
export const TOP_ADMIN_ROLE = "SUPER_ADMIN";
