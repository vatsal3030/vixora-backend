import express from "express";
import request from "supertest";
import { authLimiter, otpLimiter } from "../src/middlewares/rateLimit.middleware.js";
import { verifyJwt } from "../src/middlewares/auth.middleware.js";
import { globalErrorHandler } from "../src/middlewares/error.middleware.js";

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "test-access-secret";

describe("Security middleware", () => {
  it("authLimiter blocks requests after configured threshold", async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.post("/login", authLimiter, (req, res) => {
      res.status(200).json({ ok: true });
    });

    let lastResponse;
    for (let i = 0; i < 31; i++) {
      lastResponse = await request(app)
        .post("/login")
        .set("X-Forwarded-For", "10.10.0.1")
        .send({});
    }

    expect(lastResponse.status).toBe(429);
    expect(lastResponse.body.success).toBe(false);
  });

  it("otpLimiter blocks requests after configured threshold", async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.post("/otp", otpLimiter, (req, res) => {
      res.status(200).json({ ok: true });
    });

    let lastResponse;
    for (let i = 0; i < 11; i++) {
      lastResponse = await request(app)
        .post("/otp")
        .set("X-Forwarded-For", "10.10.0.2")
        .send({});
    }

    expect(lastResponse.status).toBe(429);
    expect(lastResponse.body.success).toBe(false);
    expect(lastResponse.body.message).toMatch(/otp/i);
  });

  it("verifyJwt rejects request when access token is missing", async () => {
    const app = express();
    app.get("/protected", verifyJwt, (req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(globalErrorHandler);

    const response = await request(app).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/unauthorized/i);
  });

  it("verifyJwt rejects malformed bearer token", async () => {
    const app = express();
    app.get("/protected", verifyJwt, (req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(globalErrorHandler);

    const response = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer invalid.jwt.token");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});
