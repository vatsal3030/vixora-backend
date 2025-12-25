import { Router } from "express";
import { upload } from "../middlewares/multer.middleware.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
    getAllVideos,
    getVideoById,
    deleteVideo,
    publishAVideo,
    togglePublishStatus,
    updateVideo
} from "../controllers/video.controller.js";

const router = Router();

router.use(verifyJwt);

// 🔹 GET ALL VIDEOS
router.route("/").get(getAllVideos);

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

// 🔹 DELETE VIDEO
router.route("/:videoId").delete(deleteVideo);

// 🔹 TOGGLE PUBLISH STATUS
router.route("/:videoId/publish").patch(togglePublishStatus);

export default router;
