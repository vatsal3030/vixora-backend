import express from "express";
import request from "supertest";
import {
  createUploadSession,
  finalizeUpload,
  getUploadSignature,
} from "../src/controllers/upload.controller.js";
import { globalErrorHandler } from "../src/middlewares/error.middleware.js";

const buildApp = (handler, user = { id: "user-1", emailVerified: true }) => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    next();
  });
  app.use("/test", handler);
  app.use(globalErrorHandler);
  return app;
};

describe("Upload validation guards", () => {
  it("rejects upload session when mimeType is not allowed", async () => {
    const router = express.Router();
    router.post("/session", createUploadSession);
    const app = buildApp(router);

    const response = await request(app).post("/test/session").send({
      fileName: "video.mp4",
      fileSize: 1200,
      mimeType: "application/pdf",
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/mimetype/i);
  });

  it("rejects invalid cloudinary signature resourceType", async () => {
    const router = express.Router();
    router.get("/signature", getUploadSignature);
    const app = buildApp(router);

    const response = await request(app).get("/test/signature?resourceType=evil");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/resourceType/i);
  });

  it("rejects signature when user email is not verified", async () => {
    const router = express.Router();
    router.get("/signature", getUploadSignature);
    const app = buildApp(router, { id: "user-2", emailVerified: false });

    const response = await request(app).get("/test/signature?resourceType=video");

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/verify email/i);
  });

  it("rejects finalize upload when required fields are missing", async () => {
    const router = express.Router();
    router.post("/finalize/:sessionId", finalizeUpload);
    const app = buildApp(router);

    const response = await request(app)
      .post("/test/finalize/session-1")
      .send({
        title: "",
        description: "",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/missing required fields/i);
  });
});
