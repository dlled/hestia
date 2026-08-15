import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createModelGatewayApp } from "../app.js";

describe("model-gateway", () => {
  it("protects and forwards structured completions", async () => {
    const completeStructured = vi.fn().mockResolvedValue({ kind: "unsupported", confidence: 1 });
    const app = createModelGatewayApp({ model: { completeStructured }, authToken: "test-token" });
    const body = {
      profile: "intent-fast",
      schemaName: "intent",
      jsonSchema: { type: "object" },
      system: "Return JSON.",
      input: { utterance: "hello" },
    };

    await request(app).post("/internal/v1/structured-completions").send(body).expect(401);
    await request(app)
      .post("/internal/v1/structured-completions")
      .set("authorization", "Bearer wrong-token")
      .send(body)
      .expect(401);
    const response = await request(app)
      .post("/internal/v1/structured-completions")
      .set("authorization", "Bearer test-token")
      .send(body)
      .expect(200);

    expect(response.body.output).toEqual({ kind: "unsupported", confidence: 1 });
    expect(completeStructured).toHaveBeenCalledWith(body);
  });

  it("rejects malformed contracts before reaching the provider", async () => {
    const completeStructured = vi.fn();
    const app = createModelGatewayApp({ model: { completeStructured } });
    await request(app)
      .post("/internal/v1/structured-completions")
      .send({ profile: "intent-fast" })
      .expect(400);
    expect(completeStructured).not.toHaveBeenCalled();
  });
});
