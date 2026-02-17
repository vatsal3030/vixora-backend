import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import userSafeSelect from "../utils/userSafeSelect.js";
import prisma from "../db/prisma.js";

export const verifyJwt = asyncHandler(async (req, res, next) => {
    try {
        const token =
            req.cookies?.accessToken ||
            req.header("Authorization")?.replace("Bearer ", "");

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
        next();
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
