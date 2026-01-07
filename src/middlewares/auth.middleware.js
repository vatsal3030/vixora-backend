import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import jwt from 'jsonwebtoken'
import userSafeSelect from "../utils/userSafeSelect.js";
import prisma from "../db/prisma.js";

export const verifyJwt = asyncHandler(async (req, res, next) => {
    try {
        const token = req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "")
        if (!token) throw new ApiError(401, "Unothorized request")
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

        // 🔐 HARD SECURITY RULE:
        // Deleted users must NEVER access protected routes
        if (user.isDeleted) {
            throw new ApiError(
                403,
                "Account deleted. Please restore your account to continue."
            );
        }

        req.user = user
        next()
    } catch (error) {
        // throw new ApiError(401, error?.message || "Invalid accessToken")
        throw new ApiError(401, "Unauthorized");

    }
})