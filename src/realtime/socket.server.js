import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import prisma from "../db/prisma.js";
import { normalizeOrigin } from "../config/cors.config.js";

let io = null;

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const parseCookies = (cookieHeader = "") => {
  const result = {};
  const raw = String(cookieHeader || "");
  if (!raw) return result;

  for (const piece of raw.split(";")) {
    const [k, ...rest] = piece.split("=");
    const key = String(k || "").trim();
    if (!key) continue;
    result[key] = decodeURIComponent(rest.join("=").trim() || "");
  }

  return result;
};

const readSocketToken = (socket) => {
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim().replace(/^Bearer\s+/i, "");
  }

  const headerAuth = socket.handshake?.headers?.authorization;
  if (typeof headerAuth === "string" && headerAuth.trim()) {
    return headerAuth.trim().replace(/^Bearer\s+/i, "");
  }

  const cookieMap = parseCookies(socket.handshake?.headers?.cookie);
  if (cookieMap.accessToken) {
    return cookieMap.accessToken;
  }

  return "";
};

const resolveSocketPath = () => {
  const rawPath = String(process.env.SOCKET_PATH || "/socket.io").trim();
  if (!rawPath) return "/socket.io";
  return rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
};

export const initSocketServer = ({ httpServer, allowedOrigins = [] }) => {
  if (io) return io;

  const socketEnabled = parseBool(process.env.SOCKET_ENABLED, true);
  if (!socketEnabled) {
    console.log("WebSocket server disabled by SOCKET_ENABLED.");
    return null;
  }

  const socketPath = resolveSocketPath();

  io = new Server(httpServer, {
    path: socketPath,
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        const normalizedOrigin = normalizeOrigin(origin);
        if (allowedOrigins.includes(normalizedOrigin)) {
          return callback(null, true);
        }

        return callback(new Error("Socket origin not allowed"));
      },
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = readSocketToken(socket);
      if (!token) return next(new Error("Unauthorized"));

      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      const userId = decoded?.id;
      if (!userId || typeof userId !== "string") {
        return next(new Error("Unauthorized"));
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, isDeleted: true },
      });

      if (!user || user.isDeleted) {
        return next(new Error("Unauthorized"));
      }

      socket.data.userId = user.id;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data?.userId;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    const room = `user:${userId}`;
    socket.join(room);
  });

  console.log(`WebSocket server started on path ${socketPath}`);
  return io;
};

export const getSocketServer = () => io;

export const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return false;
  io.to(`user:${userId}`).emit(event, payload);
  return true;
};

export const emitToUsers = (userIds, event, payload) => {
  if (!io || !Array.isArray(userIds) || userIds.length === 0) return 0;

  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  for (const userId of uniqueIds) {
    io.to(`user:${userId}`).emit(event, payload);
  }

  return uniqueIds.length;
};

