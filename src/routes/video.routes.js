import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
    getAllVideos,
    getVideoById,
    deleteVideo,
    getMyVideos,
    getUserVideos,
    togglePublishStatus,
    updateVideo,
    getAllDeletedVideos,
    restoreVideo,
} from "../controllers/video.controller.js";
import { cancelVideoProcessing, getVideoProcessingStatus } from "../controllers/video.processing.controller.js";

const router = Router();

router.use(verifyJwt);

// ---------- STATIC ROUTES FIRST ----------
router.route("/").get(getAllVideos);
router.route("/me").get(getMyVideos);
router.route("/user/:userId").get(getUserVideos);
router.route("/trash/me").get(getAllDeletedVideos);

// ---------- VIDEO PROCESSING ----------
router.get("/:videoId/processing-status", getVideoProcessingStatus);
router.patch("/:videoId/cancel-processing", cancelVideoProcessing);

// ---------- ACTION ROUTES ----------
router.route("/:videoId/publish").patch(togglePublishStatus);
router.route("/:videoId/restore").patch(restoreVideo);

// ---------- MAIN DYNAMIC ROUTE LAST ----------
router.route("/:videoId")
    .get(getVideoById)
    .patch(updateVideo)
    .delete(deleteVideo);

export default router;

