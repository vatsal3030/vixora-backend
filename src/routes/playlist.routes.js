import { Router } from "express";
import {
   addVideoToPlaylist,
   createPlaylist,
   deletePlaylist,
   getPlaylistById,
   getUserPlaylists,
   removeVideoFromPlaylist,
   togglePlaylistPublishStatus,
   updatePlaylist,
   restorePlaylist,
   getDeletedPlaylists,
   toggleWatchLater,
   getWatchLaterVideos,
} from "../controllers/playlist.controller.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";

const router = Router();

// 🔐 Protect all routes
router.use(verifyJwt);

/* ─────────────────────────────
   WATCH LATER (KEEP FIRST)
───────────────────────────── */

router.post("/watch-later/:videoId", toggleWatchLater);
router.get("/watch-later", getWatchLaterVideos);

/* ─────────────────────────────
   PLAYLIST CRUD
───────────────────────────── */

// Create playlist
router.post("/", createPlaylist);

// Current user's playlists
router.get("/user/me", (req, res, next) => {
   req.params.userId = req.user.id;
   return getUserPlaylists(req, res, next);
});

// ⚠️ Optional: remove or restrict this route
router.get("/user/:userId", getUserPlaylists);

/* ─────────────────────────────
   TRASH & RESTORE
───────────────────────────── */

router.get("/trash/me", getDeletedPlaylists);
router.patch("/:playlistId/restore", restorePlaylist);

/* ─────────────────────────────
   PLAYLIST VIDEO OPERATIONS
───────────────────────────── */

// Add / remove videos
router.patch("/add/:videoId/:playlistId", addVideoToPlaylist);
router.patch("/remove/:videoId/:playlistId", removeVideoFromPlaylist);

// Toggle public / private
router.patch("/:playlistId/toggle-visibility", togglePlaylistPublishStatus);

/* ─────────────────────────────
   SINGLE PLAYLIST (KEEP LAST)
───────────────────────────── */

router
   .route("/:playlistId")
   .get(getPlaylistById)
   .patch(updatePlaylist)
   .delete(deletePlaylist);

export default router;
