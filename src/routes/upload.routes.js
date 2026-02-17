import { Router } from "express";
import {
  createUploadSession,
  cancelUploadSession,
  getUploadSignature,
  updateUploadProgress,
  finalizeUpload,
} from "../controllers/upload.controller.js";

import { verifyJwt } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/session", verifyJwt, createUploadSession);
router.patch("/session/:sessionId/cancel", verifyJwt, cancelUploadSession);
router.get("/signature", verifyJwt, getUploadSignature);
router.patch("/progress/:sessionId", verifyJwt, updateUploadProgress);
router.post("/finalize/:sessionId", verifyJwt, finalizeUpload);


export default router;
