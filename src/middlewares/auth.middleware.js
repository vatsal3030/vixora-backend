import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import userSafeSelect from "../utils/userSafeSelect.js";
import prisma from "../db/prisma.js";
import { writeAccessGuard } from "./admin.middleware.js";

const parseBearerToken = (authorizationHeader) => {
    const raw = String(authorizationHeader || "").trim();
    if (!raw) return "";
    const match = raw.match(/^Bearer\s+(.+)$/i);
    if (!match) return "";
    const token = String(match[1] || "").trim();
    return token || "";
};

export const verifyJwt = asyncHandler(async (req, res, next) => {
    try {
        const token =
            req.cookies?.accessToken ||
            parseBearerToken(req.header("Authorization"));

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized request",
            });
        }

        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

        if (!decodedToken?.id || typeof decodedToken.id !== "string") {
            return res.status(401).json({
                success: false,
                message: "Invalid token payload",
            });
        }

        const user = await prisma.user.findUnique({
            where: {
                id: decodedToken.id,
            },
            select: userSafeSelect,
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid Access Token",
            });
        }

        if (user.isDeleted) {
            return res.status(403).json({
                success: false,
                message: "Account deleted. Please restore your account to continue.",
            });
        }

        req.user = user;
        return writeAccessGuard(req, res, next);
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode || 401).json({
                success: false,
                message: error.message || "Unauthorized",
            });
        }

        if (error.name === "JsonWebTokenError") {
            return res.status(401).json({
                success: false,
                message: "Invalid token format",
            });
        }

        if (error.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                message: "Token expired",
            });
        }

        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }
});

export const optionalJwt = asyncHandler(async (req, res, next) => {
    const token =
        req.cookies?.accessToken ||
        parseBearerToken(req.header("Authorization"));

    if (!token) {
        return next();
    }

    try {
        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

        if (!decodedToken?.id || typeof decodedToken.id !== "string") {
            return next();
        }

        const user = await prisma.user.findUnique({
            where: { id: decodedToken.id },
            select: userSafeSelect,
        });

        if (!user || user.isDeleted) {
            return next();
        }

        req.user = user;
        return next();
    } catch {
        return next();
    }
});
