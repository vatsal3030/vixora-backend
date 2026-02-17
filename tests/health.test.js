import request from "supertest";
import app from "../src/app.js";

describe("Health Check", () => {

  it("GET /healthz should return OK", async () => {

    const res = await request(app).get("/healthz");

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("ok");

  });

});
