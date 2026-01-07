import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import prisma from "../db/prisma.js";
import uploadOnCloudinary, { deleteImageOnCloudinary } from "../utils/cloudinary.js";
import { createUserSchema } from "../schemas/createUserSchema.js";
import { comparePassword, hashPassword } from "../utils/password.js";
import ApiResponse from "../utils/ApiResponse.js";
import { generateAccessToken } from "../utils/jwt.js";
import { generateRefreshToken } from "../utils/jwt.js";
import jwt from 'jsonwebtoken'
import userSafeSelect from '../utils/userSafeSelect.js'
import { sendEmail } from "../utils/email.js";
import { restoreOtpTemplate, emailVerificationOtpTemplate, welcomeEmailTemplate, forgotPasswordOtpTemplate } from "../utils/emailTemplates.js";

export const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await prisma.user.findUnique({
            where: {
                id: userId
            }
        })

        const accessToken = generateAccessToken(user)
        const refreshToken = generateRefreshToken(user)

        // user.refreshToken = refreshToken
        await prisma.user.update({
            where: {
                id: userId
            },
            data: {
                refreshToken
            }
        })

        return { accessToken, refreshToken }

    } catch (error) {
        throw new ApiError(400, "Something went wrong while genrating refresh and access token")
    }
}

export const registerUser = asyncHandler(async (req, res) => {
    // Validate request body
    // get user details from frontend
    // validation
    // check if user exists
    // check for images
    // upload avatar to cloudinary
    // encrypt password
    // create user in DB
    // remove password & refresh token
    // return response


    const parsed = createUserSchema.safeParse(req.body);

    if (!parsed.success) {
        throw new ApiError(400, "Invalid input", parsed.error.flatten().fieldErrors);
    }

    const { fullName, email, username, password } = parsed.data;

    if ([fullName, email, username, password].some((field) =>
        field?.trim().length === 0)) {
        throw new ApiError(400, "All fields are required")
    }

    // 3. check if user already exists
    const existingUser = await prisma.user.findFirst({
        where: {
            OR: [{ email }, { username }],
        },
    });

    if (existingUser && existingUser.emailVerified) {
        throw new ApiError(409, "User with given email or username already exists");
    }

    // 🟡 Exists but not verified → resend OTP
    if (existingUser && !existingUser.emailVerified) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await hashPassword(otp);

        await prisma.user.update({
            where: { id: existingUser.id },
            data: {
                otpHash,
                otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
                otpAttempts: 0,
                otpLastSentAt: new Date(),
            },
        });

        // Prepare mail content
        const mailContent = emailVerificationOtpTemplate({
            fullName: existingUser.fullName,
            otp,
        });

        // Send email using template
        try {
            await sendEmail({
                to: existingUser.email,
                subject: mailContent.subject,
                html: mailContent.html,
                text: `Your OTP is ${otp}`,
            });
        } catch (err) {
            console.warn("Verification email failed:", err.message);
        }

        return res.status(200).json(
            new ApiResponse(200, {}, "Verification OTP resent")
        );
    }

    const avatarLocalPath = req.files?.avatar[0]?.path
    // const coverImageLocalPath = req.files?.coverImage[0]?.path

    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar image is required(Local Path missing)")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!avatar) {
        throw new ApiError(400, `Avatar image is required / cloudinary problem ${avatar} `)
    }

    const hashedPassword = await hashPassword(password)

    const createdUser = await prisma.user.create({
        data: {
            fullName,
            email,
            username: username.toLowerCase(),
            avatar: avatar.url,
            avatarPublicId: avatar.public_id,
            coverImage: coverImage?.url || "",
            coverImagePublicId: coverImage?.public_id || "",
            password: hashedPassword,
        },
        select: {
            id: true,
            fullName: true,
            email: true,
            username: true,
            avatar: true,
            coverImage: true,
            createdAt: true,
        }
    });

    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user");
    }

    // 6️⃣ Generate email verification OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await hashPassword(otp);

    await prisma.user.update({
        where: { id: createdUser.id },
        data: {
            otpHash,
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min
            otpAttempts: 0,
            otpLastSentAt: new Date(),
        },
    });

    // 7️⃣ Send verification email
    // Prepare mail content
    const mailContent = emailVerificationOtpTemplate({
        fullName: createdUser.fullName,
        otp,
    });

    // Send email using template
    try {
        await sendEmail({
            to: createdUser.email,
            subject: mailContent.subject,
            html: mailContent.html,
            text: `Your OTP is ${otp}`,
        });
    } catch (err) {
        console.warn("Verification email failed:", err.message);
    }


    return res.status(201).json(
        new ApiResponse(201, {}, "User registered Successfully. Please verify your email.")
    );

})

export const verifyEmail = asyncHandler(async (req, res) => {
    const { identifier, otp } = req.body;

    if (!identifier?.trim() || !otp?.trim()) {
        throw new ApiError(400, "Identifier and OTP are required");
    }

    // 🔍 Find user by email OR username
    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { email: identifier.toLowerCase().trim() },
                { username: identifier.toLowerCase().trim() }
            ]
        }
    });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (user.emailVerified) {
        return res.status(200).json(
            new ApiResponse(200, {}, "Email already verified")
        );
    }

    if (!user.otpHash || !user.otpExpiresAt) {
        throw new ApiError(400, "OTP not requested");
    }

    // ⏰ OTP expiry check
    if (user.otpExpiresAt < new Date()) {
        throw new ApiError(400, "OTP expired");
    }

    // 🚫 Too many attempts
    if (user.otpAttempts >= 5) {
        throw new ApiError(
            429,
            "Too many incorrect attempts. Please request a new OTP."
        );
    }

    // 🔐 Validate OTP
    const isOtpValid = await comparePassword(otp, user.otpHash);
    if (!isOtpValid) {
        await prisma.user.update({
            where: { id: user.id },
            data: {
                otpAttempts: { increment: 1 }
            }
        });

        throw new ApiError(400, "Invalid OTP");
    }

    // ✅ OTP correct → verify email
    await prisma.user.update({
        where: { id: user.id },
        data: {
            emailVerified: true,
            otpHash: null,
            otpExpiresAt: null,
            otpAttempts: 0,
            otpLastSentAt: null,
        }
    });

    // 📧 Send welcome email (NON-BLOCKING)
    const mail = welcomeEmailTemplate({
        fullName: user.fullName,
    });

    try {
        await sendEmail({
            to: user.email,
            subject: mail.subject,
            html: mail.html,
            text: "Welcome to Vidora",
        });
    } catch (err) {
        console.warn("Welcome email failed:", err.message);
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "Email verified successfully")
    );
});

export const resendOtp = asyncHandler(async (req, res) => {
    const { identifier } = req.body;

    if (!identifier?.trim()) {
        throw new ApiError(400, "Email or username is required");
    }

    // Find user by email OR username
    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { email: identifier.toLowerCase().trim() },
                { username: identifier.toLowerCase().trim() }
            ]
        }
    });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (user.emailVerified) {
        throw new ApiError(400, "Email already verified");
    }

    // Check resend cooldown (2 minutes)
    if (
        user.otpLastSentAt &&
        Date.now() - user.otpLastSentAt.getTime() < 2 * 60 * 1000
    ) {
        throw new ApiError(429, "Please wait before requesting again");
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await hashPassword(otp);

    await prisma.user.update({
        where: { id: user.id },
        data: {
            otpHash,
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min
            otpAttempts: 0,
            otpLastSentAt: new Date(),
        },
    });

    // Send verification email
    const mailContent = emailVerificationOtpTemplate({
        fullName: user.fullName,
        otp,
    });

    try {
        await sendEmail({
            to: user.email,
            subject: mailContent.subject,
            html: mailContent.html,
            text: `Your OTP is ${otp}`,
        });
    } catch (err) {
        console.warn("Verification email failed:", err.message);
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "Verification OTP resent successfully")
    );
});

export const loginUser = asyncHandler(async (req, res) => {
    //   req->body -> data
    //   username or email based login
    // find user
    // password check
    // accessToken and refreshToken
    // send cookie 

    const { email, username, password } = req.body

    if (!username && !email) {
        throw new ApiError(400, "username or email is required")
    }

    const user = await prisma.user.findFirst({
        where: {
            OR: [{ email }, { username }]
        }
    })

    if (!user) {
        throw new ApiError(404, "User not found")
    }

    // 🔥 THIS IS THE MAIN FIX
    if (!user.emailVerified) {
        throw new ApiError(403, "Email not verified. Verify OTP first.");
    }

    if (user.authProvider !== "LOCAL") {
        throw new ApiError(
            400,
            "This account uses Google sign-in. Please continue with Google."
        );
    }


    const isPasswordValid = await comparePassword(password, user.password)

    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid credentials")
    }

    const { accessToken, refreshToken } = await generateAccessAndRefreshToken(user.id)

    const loggedInUser = await prisma.user.findUnique({
        where: {
            id: user.id,
        },
        select: {
            id: true,
            fullName: true,
            email: true,
            username: true,
            avatar: true,
            coverImage: true,
            createdAt: true,
        },
    });


    const options = {
        httpOnly: true,
        secure: true,
        sameSite: "none",   // REQUIRED
    }

    return res.
        status(200).
        cookie("accessToken", accessToken, options).
        cookie("refreshToken", refreshToken, options).
        json(
            new ApiResponse
                (
                    200,
                    {
                        user: loggedInUser,
                        //  refreshToken 
                    },
                    "User Logged In Successfully"
                )
        )

})

export const logOutUser = asyncHandler(async (req, res) => {
    await prisma.user.update({
        where: {
            id: req.user.id
        },
        data: {
            refreshToken: null
        }
    })

    const options = {
        httpOnly: true,
        secure: true,
        sameSite: "none",   // REQUIRED
    }

    return res.
        status(200).
        clearCookie("accessToken", options).
        clearCookie("refreshToken", options).
        json(
            new ApiResponse
                (200,
                    {},
                    "User logged out successfully"
                ))
})

export const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken
    if (!incomingRefreshToken) throw new ApiError(401, "Unothorized request")

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)

        const user = await prisma.user.findUnique({
            where: { id: decodedToken?.id }
        })

        if (!user) throw new ApiError(401, "Invalid refresh token")

        if (incomingRefreshToken !== user.refreshToken) throw new ApiError(401, "Refresh token is expired or used")

        const options = {
            httpOnly: true,
            secure: true,
            sameSite: "none",   // REQUIRED
        }

        const { accessToken, newRefreshToken } = await generateAccessAndRefreshToken(user.id)

        return res.
            status(200).
            cookie("accessToken", accessToken, options).
            cookie("refreshToken", newRefreshToken, options).
            json(
                new ApiResponse(200,
                    {
                        // accessToken, refreshToken: newRefreshToken 
                    },
                    "Access token refreshed successfully"
                )
            )
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token")
    }

})

export const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    // 1. Get user with password
    const user = await prisma.user.findUnique({
        where: {
            id: req.user?.id,
        },
        select: {
            id: true,
            password: true,
        },
    });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // 2. Check old password
    const isPasswordCorrect = await comparePassword(
        oldPassword,
        user.password
    );

    if (!isPasswordCorrect) {
        throw new ApiError(401, "Invalid old password");
    }

    // 3. Hash new password
    const newHashedPassword = await hashPassword(newPassword);

    // 4. Update DB
    await prisma.user.update({
        where: {
            id: user.id,
        },
        data: {
            password: newHashedPassword,
        },
    });

    return res.
        status(200).
        json(
            new ApiResponse(200, {}, "Password updated successfully")
        );

})

export const forgotPasswordRequest = asyncHandler(async (req, res) => {
    const { email } = req.body;

    const normalizedEmail = email.toLowerCase().trim()

    if (!email?.trim()) {
        throw new ApiError(400, "Email is required");
    }

    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
    });

    // 🔐 Do NOT reveal user existence
    if (!user || user.isDeleted) {
        return res.status(404).json(
            new ApiResponse(404, {}, "User not found")
        );
    }

    // ⏱ resend cooldown
    if (
        user.otpLastSentAt &&
        Date.now() - user.otpLastSentAt.getTime() < 2 * 60 * 1000
    ) {
        throw new ApiError(429, "Please wait before requesting again");
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await hashPassword(otp);

    await prisma.user.update({
        where: { id: user.id },
        data: {
            otpHash,
            otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
            otpAttempts: 0,
            otpLastSentAt: new Date(),
        },
    });

    const mail = forgotPasswordOtpTemplate({
        fullName: user.fullName,
        otp,
    });

    await sendEmail({
        to: user.email,
        subject: mail.subject,
        html: mail.html,
        text: `Your reset OTP is ${otp}`,
    });


    return res.status(200).json(
        new ApiResponse(200, {}, "If account exists, OTP will be sent ")
    );
})

export const forgotPasswordVerify = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;

    if (!email?.trim() || !otp?.trim()) {
        throw new ApiError(400, "Email and OTP are required");
    }

    const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });

    if (!user || !user.otpHash || !user.otpExpiresAt) {
        throw new ApiError(400, "Invalid or expired OTP");
    }

    if (user.otpExpiresAt < new Date()) {
        throw new ApiError(400, "OTP expired");
    }

    if (user.otpAttempts >= 5) {
        throw new ApiError(429, "Too many attempts");
    }

    const isValid = await comparePassword(otp, user.otpHash);

    if (!isValid) {
        await prisma.user.update({
            where: { id: user.id },
            data: { otpAttempts: { increment: 1 } },
        });

        throw new ApiError(400, "Invalid OTP");
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "OTP verified")
    );
});

export const resetPassword = asyncHandler(async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
        throw new ApiError(400, "All fields are required");
    }

    const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });

    if (!user || !user.otpHash) {
        throw new ApiError(400, "Invalid request");
    }

    const isValid = await comparePassword(otp, user.otpHash);
    if (!isValid || user.otpExpiresAt < new Date()) {
        throw new ApiError(400, "Invalid or expired OTP");
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
        where: { id: user.id },
        data: {
            password: hashedPassword,
            otpHash: null,
            otpExpiresAt: null,
            otpAttempts: 0,
            otpLastSentAt: null,
            refreshToken: null, // 🔥 invalidate sessions
        },
    });

    return res.status(200).json(
        new ApiResponse(200, {}, "Password reset successfully. Please login.")
    );
});


export const getCurrentUser = asyncHandler(async (req, res) => {
    return res.
        status(200).
        json(new ApiResponse(200, req.user, "current user fetched successfully"))

})

export const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullName, email } = req.body;

    if (!fullName || !email) {
        throw new ApiError(400, "Full name and email are required");
    }

    try {
        const updatedUser = await prisma.user.update({
            where: {
                id: req.user.id,
            },
            data: {
                fullName,
                email,
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                username: true,
                avatar: true,
                coverImage: true,
                updatedAt: true,
            },
        });

        return res.
            status(200).
            json(
                new ApiResponse(
                    200,
                    updatedUser,
                    "Account details updated successfully"
                )
            );
    } catch (error) {
        // Unique email constraint error
        if (error.code === "P2002") {
            throw new ApiError(409, "Email is already in use");
        }
        throw new ApiError(409, error, "failed to update account details");
    }
})

export const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is missing");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);

    if (!avatar || !avatar.url) {
        throw new ApiError(
            400,
            "Error while uploading avatar file to Cloudinary"
        );
    }


    if (req.user.avatarPublicId) {
        await deleteImageOnCloudinary(req.user.avatarPublicId);
    }

    const updatedUser = await prisma.user.update({
        where: {
            id: req.user.id,
        },
        data: {
            avatar: avatar.url,
            avatarPublicId: avatar.public_id,
        },
        select: userSafeSelect, // safe fields only
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedUser,
            "Avatar updated successfully"
        )
    );
});

export const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;

    if (!coverImageLocalPath) {
        throw new ApiError(400, "coverImage file is missing");
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!coverImage || !coverImage.url) {
        throw new ApiError(
            400,
            "Error while uploading cover Image file to Cloudinary"
        );
    }

    if (req.user.coverImagePublicId) {
        await deleteImageOnCloudinary(req.user.coverImagePublicId);
    }

    const updatedUser = await prisma.user.update({
        where: {
            id: req.user.id,
        },
        data: {
            coverImage: coverImage.url,
            coverImagePublicId: coverImage.public_id,
        },
        select: userSafeSelect, // safe fields only
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedUser,
            "coverImage updated successfully"
        )
    );
});

export const getUserChannelProfile = asyncHandler(async (req, res) => {
    const { username } = req.params;
    const channel = await prisma.user.findUnique({
        where: { username: username.toLowerCase() },
        select: {
            id: true,
            fullName: true,
            username: true,
            avatar: true,
            coverImage: true,
            email: true,
        },
    });

    if (!channel) {
        throw new ApiError(404, "channel does not exist");
    }

    const [
        subscribersCount,
        channelsSubscribedToCount,
        isSubscribed,
    ] = await Promise.all([
        prisma.subscription.count({
            where: { channelId: channel.id },
        }),

        prisma.subscription.count({
            where: { subscriberId: channel.id },
        }),

        req.user?.id
            ? prisma.subscription.findUnique({
                where: {
                    subscriberId_channelId: {
                        subscriberId: req.user.id,
                        channelId: channel.id,
                    },
                },
            })
            : null,
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                ...channel,
                subscribersCount,
                channelsSubscribedToCount,
                isSubscribed: Boolean(isSubscribed),
            },
            "User channel fetched successfully"
        )
    );
})

export const getWatchHistory = asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(404, "User not found");

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            watchHistory: {
                orderBy: {
                    createdAt: "desc",
                },
                select: {
                    id: true,
                    progress: true,
                    duration: true,
                    completed: true,
                    lastWatchedAt: true,

                    // ✅ Correct relation usage
                    video: {
                        select: {
                            id: true,
                            title: true,
                            description: true,
                            thumbnail: true,
                            duration: true,
                            views: true,
                            owner: {
                                select: {
                                    id: true,
                                    fullName: true,
                                    username: true,
                                    avatar: true
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            user?.watchHistory || [],
            "Watch history fetched successfully"
        )
    );
});

export const getUserById = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
        throw new ApiError(400, "User ID is required");
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            fullName: true,
            username: true,
            avatar: true,
            coverImage: true,
            email: true,
            description: true,
            createdAt: true,
            _count: {
                select: {
                    subscribers: true,
                    subscriptions: true
                }
            }
        },
    });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Check if current user is subscribed to this channel
    const isSubscribed = req.user?.id ? await prisma.subscription.findUnique({
        where: {
            subscriberId_channelId: {
                subscriberId: req.user.id,
                channelId: userId,
            },
        },
    }) : null;

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                ...user,
                subscribersCount: user._count.subscribers,
                subscriptionsCount: user._count.subscriptions,
                isSubscribed: Boolean(isSubscribed),
                _count: undefined
            },
            "User fetched successfully"
        )
    );
});

export const updateChannelDescription = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { channelDescription, channelLinks, channelCategory } = req.body;

    const updated = await prisma.user.update({
        where: { id: userId },
        data: {
            channelDescription,
            channelLinks,
            channelCategory
        }
    });

    res.status(200).json(
        new ApiResponse(200, updated, "Channel updated successfully")
    );
});

export const deleteAccount = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    if (!userId) {
        throw new ApiError(404, "User not found");
    }

    await prisma.user.update({
        where: { id: userId },
        data: {
            isDeleted: true,
            refreshToken: null,
            deletedAt: new Date(),
        }
    });

    const cookieOptions = {
        httpOnly: true,
        secure: true,
        sameSite: "none",
    };

    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);

    return res.status(200).json(
        new ApiResponse(200, {}, "Account deleted successfully. You can restore it within 7 days.")
    );
})

export const restoreAccountRequest = asyncHandler(async (req, res) => {
    const { email, username } = req.body;

    if (!email?.trim() && !username?.trim()) {
        throw new ApiError(400, "Either email or username is required");
    }

    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { email: email?.toLowerCase().trim() },
                { username: username?.trim() }
            ]
        }
    })


    if (!user || !user.isDeleted || !user.deletedAt) {
        throw new ApiError(404, "No deleted account found with this email or username");
    }

    const restoreDeadline =
        user.deletedAt.getTime() +
        7 * 24 * 60 * 60 * 1000;

    if (Date.now() > restoreDeadline) {
        throw new ApiError(403, "Restore window expired. Account cannot be recovered.");
    }

    // ⏱ OTP resend cooldown (2 minutes)
    if (
        user.otpLastSentAt &&
        Date.now() - user.otpLastSentAt.getTime() < 2 * 60 * 1000
    ) {
        throw new ApiError(
            429,
            "OTP already sent. Please wait before requesting again."
        );
    }


    // generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await hashPassword(otp);

    await prisma.user.update({
        where: { email: email.toLowerCase().trim() },
        data: {
            otpHash,
            otpExpiresAt: new Date(Date.now() + 1000 * 60 * 5),
            otpAttempts: 0,           // 🔐 reset attempts
            otpLastSentAt: new Date() // 🔐 mark send time
        }
    })

    // after OTP generation
    const mail = restoreOtpTemplate({
        fullName: user.fullName,
        otp,
    });

    await sendEmail({
        to: user.email,
        subject: mail.subject,
        html: mail.html,
    });


    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "OTP sent to your email. Use it to restore your account."
        )
    );
})

export const restoreAccountConfirm = asyncHandler(async (req, res) => {
    const { email, username, otp } = req.body;

    if (!otp?.trim()) {
        throw new ApiError(400, "OTP is required");
    }

    if (!email?.trim() && !username?.trim()) {
        throw new ApiError(400, "Either email or username is required for restore confirmation");
    }

    const user = await prisma.user.findFirst({
        where: {
            isDeleted: true,
            OR: [
                { email: email?.toLowerCase().trim() },
                { username: username?.trim() }
            ]
        }
    })


    if (!user || !user.deletedAt) {
        throw new ApiError(404, "Deleted account not found");
    }

    if (!user.otpHash || !user.otpExpiresAt) {
        throw new ApiError(400, "OTP not requested");
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
        throw new ApiError(400, "OTP expired");
    }

    if (user.otpAttempts >= 5) {
        throw new ApiError(
            429,
            "Too many incorrect attempts. Please request a new OTP."
        );
    }

    const isOtpValid = await comparePassword(otp, user.otpHash);
    if (!isOtpValid) {
        await prisma.user.update({
            where: { id: user.id },
            data: {
                otpAttempts: { increment: 1 }
            }
        });

        throw new ApiError(400, "Invalid OTP");
    }

    // restore account
    const restoredUser = await prisma.user.update({
        where: { id: user.id },
        data: {
            isDeleted: false,
            deletedAt: null,
            otpHash: null,
            otpExpiresAt: null,
            otpAttempts: 0,       // 🔐 reset
            otpLastSentAt: null, // 🔐 reset
        },
        select: userSafeSelect
    });

    // issue fresh tokens
    const accessToken = generateAccessToken(restoredUser);
    const refreshToken = generateRefreshToken(restoredUser);

    const refreshedUser = await prisma.user.update({
        where: { id: user.id },
        data: { refreshToken },
        select: userSafeSelect
    });

    const cookieOptions = {
        httpOnly: true,
        secure: true,
        sameSite: "none",
    };

    return res
        .status(200)
        .cookie("accessToken", accessToken, cookieOptions)
        .cookie("refreshToken", refreshToken, cookieOptions)
        .json(
            new ApiResponse(
                200,
                refreshedUser,
                "Account restored successfully"
            )
        );
})



