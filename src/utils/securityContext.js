import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";

export const getSecurityContext = (req) => {
  // 🌐 Get IP
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket?.remoteAddress ||
    "Unknown";

  // 🌍 Geo Location
  const geo = geoip.lookup(ip);

  const location = geo
    ? `${geo.city || ""}, ${geo.country || ""}`
    : "Unknown Location";

  // 💻 Device + Browser
  const ua = req.headers["user-agent"] || "";
  const parser = new UAParser(ua);
  const result = parser.getResult();

  const device = result.device.model || result.os.name || "Unknown Device";
  const browser = result.browser.name || "Unknown Browser";

  return {
    ip,
    location,
    device,
    browser,
    time: new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata"
    })
  };
};
