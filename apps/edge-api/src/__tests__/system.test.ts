import request from "supertest";
import { describe, expect, it } from "vitest";
import { createEdgeApp } from "../app.js";
import type { TemporalGateway } from "../temporal.js";

function fakeTemporal(): TemporalGateway {
  return {
    async startPing() {
      return { workflowId: "hestia-ping-test", runId: "run-1" };
    },
    async describePing() {
      return {
        workflowId: "hestia-ping-test",
        runId: "run-1",
        status: "completed",
        result: {
          holdMs: 2000,
          started: {
            at: "2026-08-14T00:00:00.000Z",
            workerId: "hestia-automation",
            requestedBy: "operator",
          },
          finished: {
            at: "2026-08-14T00:00:02.000Z",
            workerId: "hestia-automation",
            requestedBy: "operator",
          },
        },
      };
    },
    async close() {
      return;
    },
  };
}

describe("system ping", () => {
  it("starts a durable ping workflow", async () => {
    const app = createEdgeApp({ temporal: fakeTemporal() });
    const started = await request(app).post("/api/v1/system/ping").send({ requestedBy: "test" });
    expect(started.status).toBe(202);
    expect(started.body.workflowId).toBe("hestia-ping-test");

    const status = await request(app).get("/api/v1/system/ping/hestia-ping-test");
    expect(status.body.status).toBe("completed");
    expect(status.body.result.holdMs).toBe(2000);
  });

  it("evaluates policy without letting a model lower risk", async () => {
    const app = createEdgeApp();
    const unlock = await request(app)
      .post("/api/v1/policy/evaluate")
      .send({ capability: "lock.unlock" });
    expect(unlock.body.effect).toBe("require_approval");
    expect(unlock.body.risk).toBe("R3");
  });
});
