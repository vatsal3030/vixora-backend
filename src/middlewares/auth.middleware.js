import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import jwt from 'jsonwebtoken'
import userSafeSelect from "../utils/userSafeSelect.js";
import prisma from "../db/prisma.js";

export const verifyJwt = asyncHandler(async (req, res, next) => {
    try {
        const token = req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "")
        
        if (!token) {
            throw new ApiError(401, "Unauthorized request")
        }

        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)

        const user = await prisma.user.findUnique({
            where: {
                id: decodedToken.id,
            },
            select: userSafeSelect
        });

        if (!user) {
            throw new ApiError(401, "Invalid Access Token");
        }

        if (user.isDeleted) {
            throw new ApiError(
                403,
                "Account deleted. Please restore your account to continue."
            );
        }

        req.user = user
        next()
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            throw new ApiError(401, "Invalid token format")
        }
        if (error.name === 'TokenExpiredError') {
            throw new ApiError(401, "Token expired")
        }
        throw new ApiError(401, error?.message || "Unauthorized")
    }
})