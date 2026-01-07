import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
    getAllNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    getUnreadNotificationCount,
    deleteAllNotifications,
    getUnreadNotifications,
} from "../controllers/notification.controller.js";

const router = Router();

// 🔐 All notification routes require authentication
router.use(verifyJwt);

// 📩 Get all notifications for logged-in user
router.get("/", getAllNotifications);

// 🔔 Get unread notification count
router.get("/unread-count", getUnreadNotificationCount);

// 🔔 Get unread notifications
router.get("/unread", getUnreadNotifications);

// ✅ Mark single notification as read
router.patch("/:notificationId/read", markNotificationRead);

// ✅ Mark all notifications as read
router.patch("/read-all", markAllNotificationsRead);

// 🗑️ Delete a single notification
router.delete("/:notificationId", deleteNotification);

// 🗑️ Delete a All notification
router.delete("/", deleteAllNotifications);

export default router;
