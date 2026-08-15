import type { ActionPlan, ApprovalDecision, AutomationRunState } from "@hestia/contracts";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAutomationApp } from "../app.js";
import type { AutomationHomeGateway } from "../home.js";
import { createMemoryAutomationRepository } from "../repository.js";
import type { AutomationTemporalGateway } from "../temporal.js";

describe("automation-service", () => {
  it("previews a sleep plan from the observed home context", async () => {
    const app = createAutomationApp({
      repository: createMemoryAutomationRepository(),
      temporal: fakeTemporal(),
      home: fakeHome(),
    });

    const response = await request(app)
      .post("/api/v1/plans/sleep/preview")
      .send({ requestedBy: "resident", armAlarm: false });

    expect(response.status).toBe(200);
    expect(response.body.plan.actions[0]).toMatchObject({
      command: { capability: "power.onOff", input: { on: false } },
      expectedObservation: { equals: "off" },
    });
  });

  it("publishes a versioned plan and starts a durable run", async () => {
    const repository = createMemoryAutomationRepository();
    const temporal = fakeTemporal();
    const app = createAutomationApp({ repository, temporal });

    const published = await request(app).post("/api/v1/plans").send(planFixture());
    expect(published.status).toBe(201);

    const started = await request(app)
      .post("/api/v1/plans/plan_sleep0123456789/versions/1/runs")
      .send({ requestedBy: "resident" });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({
      workflowId: "hestia-wf-test0123456789",
      runId: "run-test0123456789",
      planId: "plan_sleep0123456789",
      status: "running",
    });
    expect(temporal.start).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: "resident" }),
    );

    const status = await request(app).get("/api/v1/runs/hestia-wf-test0123456789");
    expect(status.status).toBe(200);
    expect(status.body.state.status).toBe("completed");
  });

  it("validates approval payloads before signalling the workflow", async () => {
    const repository = createMemoryAutomationRepository();
    const temporal = fakeTemporal();
    const app = createAutomationApp({ repository, temporal });
    await request(app).post("/api/v1/runs").send(planFixture());

    const invalid = await request(app)
      .post("/api/v1/runs/hestia-wf-test0123456789/approval")
      .send({ approved: true });
    expect(invalid.status).toBe(400);

    const approval: ApprovalDecision = {
      approvalId: "appr_test0123456789",
      approved: true,
      decidedBy: "resident",
      decidedAt: "2026-08-14T22:00:00.000Z",
    };
    const accepted = await request(app)
      .post("/api/v1/runs/hestia-wf-test0123456789/approval")
      .send(approval);
    expect(accepted.status).toBe(202);
    expect(temporal.approve).toHaveBeenCalledWith("hestia-wf-test0123456789", approval);

    const audit = await request(app).get("/api/v1/runs/hestia-wf-test0123456789/audit");
    expect(audit.status).toBe(200);
    expect(audit.body.events.map((event: { eventType: string }) => event.eventType)).toEqual([
      "run.started",
      "approval.submitted",
    ]);
  });
});

function fakeTemporal(): AutomationTemporalGateway {
  const state: AutomationRunState = {
    planId: "plan_sleep0123456789",
    status: "completed",
    currentAction: 0,
    actions: [
      {
        actionId: "action_light012345",
        commandId: "cmd_light0123456789",
        status: "confirmed",
      },
    ],
    startedAt: "2026-08-14T22:00:00.000Z",
    finishedAt: "2026-08-14T22:00:01.000Z",
  };
  return {
    start: vi.fn(async () => ({
      workflowId: "hestia-wf-test0123456789",
      runId: "run-test0123456789",
    })),
    state: vi.fn(async () => state),
    approve: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
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

function fakeHome(): AutomationHomeGateway {
  return {
    async getSleepContext() {
      return {
        homeId: "home_primary",
        generatedAt: "2026-08-14T22:00:00.000Z",
        readiness: "ready",
        summary: { relevant: 1, stale: 0, unavailable: 0 },
        categories: {
          lights: [
            {
              entityId: "ent_light0123456789",
              name: "Bedroom lamp",
              domain: "light",
              observedState: {
                value: "on",
                timestamp: "2026-08-14T22:00:00.000Z",
                source: "home_assistant:ha_main",
                quality: "good",
              },
              attention: "ready",
            },
          ],
          climate: [],
          covers: [],
          media: [],
          alarm: [],
        },
      };
    },
  };
}
