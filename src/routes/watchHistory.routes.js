import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";

import {
  clearWatchHistory,
  getProgressForVideos,
  getContinueWatching,
  removeWatchHistoryItem,
  saveWatchProgress,
  getWatchProgress
} from "../controllers/watchHistory.controller.js";

const router = Router();

// All routes are protected
router.use(verifyJwt);

// Get continue watching list (must come before /:videoId)
router.get("/", getContinueWatching);
router.delete("/", clearWatchHistory);

// Save / update watch progress
router.post("/", saveWatchProgress);

// // Get progress for a single video
router.get("/:videoId", getWatchProgress);
router.delete("/:videoId", removeWatchHistoryItem);

// Get progress for multiple videos (bulk)
router.post("/bulk", getProgressForVideos);

export default router;
