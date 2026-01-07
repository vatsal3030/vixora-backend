import { Router } from "express";
import { upload } from "../middlewares/multer.middleware.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
    getAllVideos,
    getVideoById,
    deleteVideo,
    getMyVideos,
    getUserVideos,
    publishAVideo,
    togglePublishStatus,
    updateVideo,
    getAllDeletedVideos,
    restoreVideo
} from "../controllers/video.controller.js";

const router = Router();

router.use(verifyJwt);

// 🔹 GET ALL VIDEOS
router.route("/").get(getAllVideos);
router.route("/me").get(getMyVideos);
router.route("/user/:userId").get(getUserVideos);

// 🔹 PUBLISH VIDEO
router.route("/").
    post(
        upload.fields(
            [
                { name: "videoFile", maxCount: 1 },
                { name: "thumbnail", maxCount: 1 }
            ]
        ),
        publishAVideo
    );

// 🔹 GET VIDEO BY ID
router.route("/:videoId").get(getVideoById);

// 🔹 UPDATE VIDEO
router.route("/:videoId").patch(upload.single("thumbnail"), updateVideo);

// 🔹SOFT DELETE VIDEO
router.route("/:videoId").delete(deleteVideo);

// 🔹 TOGGLE PUBLISH STATUS
router.route("/:videoId/publish").patch(togglePublishStatus);

// ─────────────────────────────
// 🗑️ TRASH (SOFT-DELETED VIDEOS)
// ─────────────────────────────

// Get all deleted videos (last 7 days)
router.route("/trash/me")
    .get(getAllDeletedVideos);

// Restore deleted video
router.route("/:videoId/restore")
    .patch(restoreVideo);


export default router;
