import express from "express";
import { getVideoTranscript, watchVideo } from "../controllers/watch.controller.js";
import { getVideoStreamingData } from "../controllers/video.stream.controller.js";
import { optionalJwt } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/:videoId/transcript", optionalJwt, getVideoTranscript);
router.get("/:videoId/stream", optionalJwt, getVideoStreamingData);
router.get("/:videoId", optionalJwt, watchVideo);

export default router;
