import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
  getUserSettings,
  updateUserSettings,
  resetUserSettings
} from "../controllers/settings.controller.js";

const router = Router();

router.use(verifyJwt);


// GET current user settings
router.get("/", getUserSettings);

// UPDATE settings (partial allowed)
router.patch("/", updateUserSettings);

// RESET to defaults
router.post("/reset", resetUserSettings);

export default router;
