import { Router } from 'express';
import {
    addVideoToPlaylist,
    createPlaylist,
    deletePlaylist,
    getPlaylistById,
    getUserPlaylists,
    removeVideoFromPlaylist,
    togglePlaylistPublishStatus,
    updatePlaylist,
} from "../controllers/playlist.controller.js"
import { verifyJwt } from "../middlewares/auth.middleware.js"

const router = Router();

router.use(verifyJwt); // Apply verifyJWT middleware to all routes in this file

router.route("/")
    .post(createPlaylist);

// Get current user's playlists
router.route("/user/me").get(async (req, res) => {
    // Redirect to getUserPlaylists with current user's ID
    req.params.userId = req.user.id;
    return getUserPlaylists(req, res);
});

router.route("/:playlistId")
    .get(getPlaylistById)
    .patch(updatePlaylist)
    .delete(deletePlaylist);

// remain part to test

// Add / remove videos
router.route("/add/:videoId/:playlistId").patch(addVideoToPlaylist);
router.route("/remove/:videoId/:playlistId").patch(removeVideoFromPlaylist);

// User playlists
router.route("/user/:userId").get(getUserPlaylists);

// ✅ Toggle playlist public/private
router.route("/:playlistId/toggle-visibility").patch(togglePlaylistPublishStatus);

export default router