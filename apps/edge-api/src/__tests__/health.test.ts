import request from "supertest";
import { describe, expect, it } from "vitest";
import { createEdgeApp } from "../app.js";

describe("edge-api health", () => {
  it("reports liveness without Temporal", async () => {
    const app = createEdgeApp();
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.service).toBe("edge-api");
    expect(response.body.status).toBe("ok");
  });

  it("exposes product meta and capabilities", async () => {
    const app = createEdgeApp();
    const meta = await request(app).get("/api/v1/meta");
    expect(meta.body.phase).toBe("3-agentic-control");
    const capabilities = await request(app).get("/api/v1/capabilities");
    expect(capabilities.body.capabilities.length).toBeGreaterThan(5);
  });
});
