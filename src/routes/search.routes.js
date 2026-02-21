import { Router } from "express";
import { optionalJwt } from "../middlewares/auth.middleware.js";
import { searchPublic } from "../controllers/search.controller.js";

const router = Router();

router.get("/", optionalJwt, searchPublic);

export default router;

