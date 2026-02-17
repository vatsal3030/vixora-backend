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
import { upload } from "../middlewares/multer.middleware.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
const router = Router();

router.post("/register", registerUser);
router.route("/verify-email").post(verifyEmail)
router.route("/resend-otp").post(resendOtp)

router.route("/login").post(loginUser)
router.route("/logout").post(verifyJwt, logOutUser)
router.route("/refresh-token").post(refreshAccessToken);

router.route("/current-user").get(verifyJwt, getCurrentUser)

router.route("/forgot-password").post(forgotPasswordRequest)
router.route("/forgot-password/verify").post(forgotPasswordVerify)
router.route("/reset-password").post(resetPassword)

router.route("/change-password").post(verifyJwt, changeCurrentPassword)

router.route("/update-account").patch(verifyJwt, updateAccountDetails)
router.patch("/update-avatar", verifyJwt, updateUserAvatar);
router.patch("/update-coverImage", verifyJwt, updateUserCoverImage);
router.route("/update-description").patch(verifyJwt, updateChannelDescription)

router.route("/u/:username").get(verifyJwt, getUserChannelProfile)
router.route("/id/:userId").get(verifyJwt, getUserById)

router.route("/delete-account").delete(verifyJwt, deleteAccount)
router.route("/restore-account/request").patch(restoreAccountRequest)
router.route("/restore-account/confirm").patch(restoreAccountConfirm)

router.route("/change-email/request").post(verifyJwt, changeEmailRequest)
router.route("/change-email/confirm").post(verifyJwt, confirmEmailChange)
router.route("/change-email/cancel").post(verifyJwt, cancelEmailChange) // optional


export default router;


