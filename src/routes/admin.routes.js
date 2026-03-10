import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
  ensureAdminPanelEnabled,
  requireAdminRole,
  verifyAdmin,
} from "../middlewares/admin.middleware.js";
import {
  getAdminDashboardActivity,
  getAdminDashboardOverview,
  getAdminMe,
} from "../controllers/admin/admin.dashboard.controller.js";
import {
  getAdminReports,
  getAdminReportById,
  resolveAdminReport,
} from "../controllers/admin/admin.reports.controller.js";
import {
  getAdminUserById,
  getAdminUsers,
  restoreAdminUser,
  softDeleteAdminUser,
  updateAdminUserRole,
  updateAdminUserStatus,
  verifyAdminPendingEmail,
} from "../controllers/admin/admin.users.controller.js";
import {
  getAdminCommentById,
  getAdminComments,
  getAdminPlaylistById,
  getAdminPlaylists,
  getAdminTweetById,
  getAdminTweets,
  getAdminVideoById,
  getAdminVideos,
  publishAdminVideo,
  restoreAdminComment,
  restoreAdminPlaylist,
  restoreAdminTweet,
  restoreAdminVideo,
  softDeleteAdminComment,
  softDeleteAdminPlaylist,
  softDeleteAdminTweet,
  softDeleteAdminVideo,
  unpublishAdminVideo,
} from "../controllers/admin/admin.content.controller.js";
import {
  getAdminAuditLogById,
  getAdminAuditLogs,
} from "../controllers/admin/admin.audit.controller.js";
import { seedAdminFeedTopics } from "../controllers/admin/admin.feed.controller.js";

const router = Router();

router.use(verifyJwt, ensureAdminPanelEnabled, verifyAdmin);

router.get("/me", getAdminMe);

router.get("/dashboard/overview", getAdminDashboardOverview);
router.get("/dashboard/activity", getAdminDashboardActivity);
router.post("/feed/topics/seed", getAdminOrAbove(), seedAdminFeedTopics);

router.get("/reports", getAdminReports);
router.get("/reports/:reportId", getAdminReportById);
router.patch("/reports/:reportId/resolve", getModeratorOrAbove(), resolveAdminReport);

router.get("/users", getAdminUsers);
router.get("/users/:userId", getAdminUserById);
router.patch("/users/:userId/status", getModeratorOrAbove(), updateAdminUserStatus);
router.patch("/users/:userId/verify-pending-email", getAdminOrAbove(), verifyAdminPendingEmail);
router.patch("/users/:userId/soft-delete", getAdminOrAbove(), softDeleteAdminUser);
router.patch("/users/:userId/restore", getAdminOrAbove(), restoreAdminUser);
router.patch("/users/:userId/role", requireAdminRole("SUPER_ADMIN"), updateAdminUserRole);

router.get("/videos", getAdminVideos);
router.get("/videos/:videoId", getAdminVideoById);
router.patch("/videos/:videoId/unpublish", getModeratorOrAbove(), unpublishAdminVideo);
router.patch("/videos/:videoId/publish", getModeratorOrAbove(), publishAdminVideo);
router.patch("/videos/:videoId/soft-delete", getModeratorOrAbove(), softDeleteAdminVideo);
router.patch("/videos/:videoId/restore", getModeratorOrAbove(), restoreAdminVideo);

router.get("/tweets", getAdminTweets);
router.get("/tweets/:tweetId", getAdminTweetById);
router.patch("/tweets/:tweetId/soft-delete", getModeratorOrAbove(), softDeleteAdminTweet);
router.patch("/tweets/:tweetId/restore", getModeratorOrAbove(), restoreAdminTweet);

router.get("/comments", getAdminComments);
router.get("/comments/:commentId", getAdminCommentById);
router.patch("/comments/:commentId/soft-delete", getModeratorOrAbove(), softDeleteAdminComment);
router.patch("/comments/:commentId/restore", getModeratorOrAbove(), restoreAdminComment);

router.get("/playlists", getAdminPlaylists);
router.get("/playlists/:playlistId", getAdminPlaylistById);
router.patch("/playlists/:playlistId/soft-delete", getModeratorOrAbove(), softDeleteAdminPlaylist);
router.patch("/playlists/:playlistId/restore", getModeratorOrAbove(), restoreAdminPlaylist);

router.get("/audit-logs", getAdminOrAbove(), getAdminAuditLogs);
router.get("/audit-logs/:logId", getAdminOrAbove(), getAdminAuditLogById);

function getModeratorOrAbove() {
  return requireAdminRole("MODERATOR", "ADMIN", "SUPER_ADMIN");
}

function getAdminOrAbove() {
  return requireAdminRole("ADMIN", "SUPER_ADMIN");
}

export default router;
