import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
  getSettings,
  updateSettings,
  resetSettings
} from "../controllers/settings.controller.js";

const router = Router();

// All routes are protected
router.use(verifyJwt);

// Get user settings
router.get("/", getSettings);

// Update user settings
router.patch("/", updateSettings);

// Reset settings to default
router.post("/reset", resetSettings);

export default router;