import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";

import {
  getProgressForVideos,
  getContinueWatching,
  saveWatchProgress,
  getWatchProgress
} from "../controllers/watchHistory.controller.js";

const router = Router();

// All routes are protected
router.use(verifyJwt);

// Get continue watching list (must come before /:videoId)
router.get("/", getContinueWatching);

// Save / update watch progress
router.post("/", saveWatchProgress);

// // Get progress for a single video
router.get("/:videoId", getWatchProgress);

// Get progress for multiple videos (bulk)
router.post("/bulk", getProgressForVideos);

export default router;
