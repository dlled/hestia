import type { ActionPlan, ApprovalDecision } from "@hestia/contracts";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createEdgeApp } from "../app.js";
import type { AutomationGateway, AutomationRunView } from "../automation.js";

describe("automation edge routes", () => {
  it("validates and forwards a typed action plan", async () => {
    const automation = fakeAutomation();
    const response = await request(createEdgeApp({ automation }))
      .post("/api/v1/automations/runs")
      .send(planFixture());

    expect(response.status).toBe(202);
    expect(response.body.workflowId).toBe("hestia-wf-edge0123456789");
    expect(automation.start).toHaveBeenCalledOnce();
  });

  it("rejects malformed plans at the public boundary", async () => {
    const automation = fakeAutomation();
    const response = await request(createEdgeApp({ automation }))
      .post("/api/v1/automations/runs")
      .send({ title: "missing contract" });

    expect(response.status).toBe(400);
    expect(automation.start).not.toHaveBeenCalled();
  });
});

function fakeAutomation(): AutomationGateway {
  return {
    previewSleepPlan: vi.fn(async () => ({ plan: planFixture(), skipped: [] })),
    publish: vi.fn(async (plan: ActionPlan) => plan),
    start: vi.fn(async () => ({ workflowId: "hestia-wf-edge0123456789" })),
    startPublished: vi.fn(async () => ({ workflowId: "hestia-wf-edge0123456789" })),
    getRun: vi.fn(
      async (): Promise<AutomationRunView> => ({
        workflowId: "hestia-wf-edge0123456789",
        runId: "run-edge0123456789",
        planId: "plan_sleep0123456789",
        version: 1,
        startedAt: "2026-08-14T22:00:00.000Z",
        state: {
          planId: "plan_sleep0123456789",
          status: "completed",
          currentAction: 0,
          actions: [],
          startedAt: "2026-08-14T22:00:00.000Z",
        },
      }),
    ),
    getAudit: vi.fn(async () => ({
      workflowId: "hestia-wf-edge0123456789",
      events: [],
    })),
    approve: vi.fn(async (_workflowId: string, _decision: ApprovalDecision) => ({
      accepted: true,
    })),
    cancel: vi.fn(async () => ({ accepted: true })),
  };
}

function planFixture(): ActionPlan {
  return {
    planId: "plan_sleep0123456789",
    version: 1,
    homeId: "home_primary",
    title: "Go to sleep",
    requestedBy: "operator",
    createdAt: "2026-08-14T22:00:00.000Z",
    actions: [
      {
        actionId: "action_light012345",
        command: {
          commandId: "cmd_light0123456789",
          idempotencyKey: "sleep-light-off-1",
          capability: "power.onOff",
          target: { homeId: "home_primary", entityId: "ent_light0123456789" },
          input: { on: false },
          risk: "R1",
          dryRun: false,
        },
        expectedObservation: {
          entityId: "ent_light0123456789",
          attribute: "state",
          equals: "off",
          timeoutMs: 30_000,
        },
      },
    ],
    dryRun: false,
  };
}
