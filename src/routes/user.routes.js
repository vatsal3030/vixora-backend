import { Router } from "express";
import {
    registerUser,
    updateChannelDescription,
    changeCurrentPassword,
    getCurrentUser,
    getUserChannelProfile,
    getUserById,
    getWatchHistory,
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
    resetPassword
} from "../controllers/user.controller.js";
import { upload } from "../middlewares/multer.middleware.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
const router = Router();

router.route("/register").post(
    upload.fields([
        {
            name: "avatar",
            maxCount: 1
        },
        {
            name: "coverImage",
            maxCount: 1
        }
    ]),
    registerUser
)
router.route("/verify-email").post(verifyEmail)

router.route("/login").post(loginUser)
router.route("/logout").post(verifyJwt, logOutUser)
router.route("/refresh-token").post(refreshAccessToken);

router.route("/current-user").get(verifyJwt, getCurrentUser)

router.route("/forgot-password").post(forgotPasswordRequest)
router.route("/forgot-password/verify").post(forgotPasswordVerify)
router.route("/reset-password").post(resetPassword)

router.route("/change-password").post(verifyJwt, changeCurrentPassword)

router.route("/update-account").patch(verifyJwt, updateAccountDetails)
router.route("/update-avatar").patch(verifyJwt, upload.single("avatar"), updateUserAvatar)
router.route("/update-coverImage").patch(verifyJwt, upload.single("coverImage"), updateUserCoverImage)
router.route("/update-description").patch(verifyJwt, updateChannelDescription)

router.route("/u/:username").get(verifyJwt, getUserChannelProfile)
router.route("/id/:userId").get(verifyJwt, getUserById)
router.route("/History").get(verifyJwt, getWatchHistory)

router.route("/delete-account").delete(verifyJwt, deleteAccount)
router.route("/restore-account/request").patch( restoreAccountRequest)
router.route("/restore-account/confirm").patch( restoreAccountConfirm)

export default router;


