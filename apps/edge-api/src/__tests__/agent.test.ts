import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createEdgeApp } from "../app.js";

describe("agent edge routes", () => {
  it("validates and forwards a resident intent", async () => {
    const previewIntent = vi.fn(async () => ({
      interpretation: {
        kind: "unsupported" as const,
        confidence: 0.9,
        summary: "This intent is not supported yet",
        sleep: null,
      },
      modelProfile: "intent-fast",
    }));
    const response = await request(createEdgeApp({ agent: fakeAgent(previewIntent) }))
      .post("/api/v1/intents/preview")
      .send({ utterance: "Water the garden" });

    expect(response.status).toBe(200);
    expect(response.body.interpretation.kind).toBe("unsupported");
    expect(previewIntent).toHaveBeenCalledWith({
      utterance: "Water the garden",
      requestedBy: "resident",
    });
  });

  it("rejects empty intent before forwarding", async () => {
    const previewIntent = vi.fn();
    const response = await request(createEdgeApp({ agent: fakeAgent(previewIntent) }))
      .post("/api/v1/intents/preview")
      .send({ utterance: " " });
    expect(response.status).toBe(400);
    expect(previewIntent).not.toHaveBeenCalled();
  });

  it("forwards durable intent runs and clarifications", async () => {
    const agent = fakeAgent();
    const started = await request(createEdgeApp({ agent }))
      .post("/api/v1/intents/runs")
      .send({ utterance: "Make the house comfortable" });
    expect(started.status).toBe(202);

    const state = await request(createEdgeApp({ agent })).get(
      `/api/v1/intents/runs/${started.body.workflowId}`,
    );
    expect(state.body.status).toBe("awaiting_clarification");

    const clarification = await request(createEdgeApp({ agent }))
      .post(`/api/v1/intents/runs/${started.body.workflowId}/clarification`)
      .send({ text: "I am going to sleep", providedBy: "resident" });
    expect(clarification.status).toBe(202);
    expect(agent.clarifyIntent).toHaveBeenCalledOnce();
  });
});

function fakeAgent(previewIntent = vi.fn(async () => unsupportedPreview())) {
  return {
    previewIntent,
    startIntent: vi.fn(async () => ({
      workflowId: "hestia-wf-agent0123456789",
      runId: "run-agent0123456789",
    })),
    getIntentRun: vi.fn(async () => ({
      status: "awaiting_clarification" as const,
      request: { utterance: "Make the house comfortable", requestedBy: "resident" },
      attempt: 1,
      interpretation: unsupportedPreview().interpretation,
    })),
    clarifyIntent: vi.fn(async () => ({ accepted: true })),
  };
}

function unsupportedPreview() {
  return {
    interpretation: {
      kind: "unsupported" as const,
      confidence: 0.9,
      summary: "This intent is not supported yet",
      sleep: null,
    },
    modelProfile: "intent-fast",
  };
}
