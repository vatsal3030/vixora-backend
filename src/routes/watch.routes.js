import express from "express";
import { watchVideo } from "../controllers/watch.controller.js";
import { optionalJwt } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/:videoId", optionalJwt, watchVideo);

export default router;
