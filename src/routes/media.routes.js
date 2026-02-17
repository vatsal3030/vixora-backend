import { Router } from "express";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
  finalizeImageUpload,
  deleteImage
} from "../controllers/media.controller.js";

const router = Router();

router.post(
  "/finalize/:sessionId",
  verifyJwt,
  finalizeImageUpload
);

router.delete(
  "/:type",
  verifyJwt,
  deleteImage
);

export default router;
