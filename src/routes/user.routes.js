import { Router } from "express";
import {
    registerUser,
    updateChannelDescription,
    changeCurrentPassword,
    getCurrentUser,
    getUserChannelProfile,
    getUserById,
    loginUser, logOutUser,
    refreshAccessToken,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    deleteAccount,
    restoreAccountRequest,
    restoreAccountConfirm,
    forgotPasswordRequest,
    forgotPasswordVerify,
    verifyEmail,
    resetPassword,
    resendOtp,
    changeEmailRequest,
    confirmEmailChange,
    cancelEmailChange
} from "../controllers/user.controller.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import { authLimiter, otpLimiter } from "../middlewares/rateLimit.middleware.js";
const router = Router();

router.post("/register", authLimiter, registerUser);
router.route("/verify-email").post(otpLimiter, verifyEmail)
router.route("/resend-otp").post(otpLimiter, resendOtp)

router.route("/login").post(authLimiter, loginUser)
router.route("/logout").post(verifyJwt, logOutUser)
router.route("/refresh-token").post(authLimiter, refreshAccessToken);

router.route("/current-user").get(verifyJwt, getCurrentUser)

router.route("/forgot-password").post(otpLimiter, forgotPasswordRequest)
router.route("/forgot-password/verify").post(otpLimiter, forgotPasswordVerify)
router.route("/reset-password").post(authLimiter, resetPassword)

router.route("/change-password").post(verifyJwt, changeCurrentPassword)

router.route("/update-account").patch(verifyJwt, updateAccountDetails)
router.patch("/update-avatar", verifyJwt, updateUserAvatar);
router.patch("/update-coverImage", verifyJwt, updateUserCoverImage);
router.route("/update-description").patch(verifyJwt, updateChannelDescription)

router.route("/u/:username").get(verifyJwt, getUserChannelProfile)
router.route("/id/:userId").get(verifyJwt, getUserById)

router.route("/delete-account").delete(verifyJwt, deleteAccount)
router.route("/restore-account/request").patch(otpLimiter, restoreAccountRequest)
router.route("/restore-account/confirm").patch(otpLimiter, restoreAccountConfirm)

router.route("/change-email/request").post(verifyJwt, otpLimiter, changeEmailRequest)
router.route("/change-email/confirm").post(verifyJwt, otpLimiter, confirmEmailChange)
router.route("/change-email/cancel").post(verifyJwt, cancelEmailChange) // optional


export default router;


