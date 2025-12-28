import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";

import {
  getProgressForVideos,
  getContinueWatching,
  getWatchProgress,
  saveWatchProgress
} from "../controllers/watchHistory.controller.js";

const router = Router();

// All routes are protected
router.use(verifyJwt);

// Save / update watch progress
router.post("/", saveWatchProgress);

// Get progress for a single video
router.get("/:videoId", getWatchProgress);

// Get continue watching list
router.get("/", getContinueWatching);

// Get progress for multiple videos (bulk)
router.post("/bulk", getProgressForVideos);

export default router;
