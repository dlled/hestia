import type { ActionPlan, AutomationRunState } from "@hestia/contracts";
import { describe, expect, it, vi } from "vitest";
import { createAutomationRunMonitor } from "../monitor.js";
import { createMemoryAutomationRepository } from "../repository.js";
import type { AutomationTemporalGateway } from "../temporal.js";

describe("automation run monitor", () => {
  it("materializes workflow transitions in an immutable audit ledger", async () => {
    const repository = createMemoryAutomationRepository();
    await repository.savePlan(planFixture());
    await repository.saveRun({
      workflowId: "hestia-wf-monitor012345",
      runId: "run-monitor0123456789",
      planId: "plan_monitor0123456789",
      version: 1,
      startedAt: "2026-08-14T22:00:00.000Z",
      status: "proposed",
    });
    const states = [state("executing", "executing"), state("completed", "confirmed")];
    const temporal: AutomationTemporalGateway = {
      start: vi.fn(),
      state: vi.fn(async () => states.shift() ?? state("completed", "confirmed")),
      approve: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
    };
    const monitor = createAutomationRunMonitor({ repository, temporal, pollMs: 1 });

    monitor.track("hestia-wf-monitor012345");
    await waitFor(
      async () => (await repository.getRun("hestia-wf-monitor012345"))?.status === "completed",
    );
    await monitor.close();

    const events = await repository.listAudit("hestia-wf-monitor012345");
    expect(events.map((event) => event.details.status)).toEqual(["executing", "completed"]);
    expect(events[1]?.details.actions).toMatchObject([{ status: "confirmed" }]);
  });
});

function state(
  status: AutomationRunState["status"],
  actionStatus: AutomationRunState["actions"][number]["status"],
): AutomationRunState {
  return {
    planId: "plan_monitor0123456789",
    status,
    currentAction: 0,
    actions: [
      {
        actionId: "action_monitor012345",
        commandId: "cmd_monitor0123456789",
        status: actionStatus,
      },
    ],
    startedAt: "2026-08-14T22:00:00.000Z",
    ...(status === "completed" ? { finishedAt: "2026-08-14T22:00:01.000Z" } : {}),
  };
}

function planFixture(): ActionPlan {
  return {
    planId: "plan_monitor0123456789",
    version: 1,
    homeId: "home_primary",
    title: "Monitor test",
    requestedBy: "test",
    createdAt: "2026-08-14T22:00:00.000Z",
    actions: [
      {
        actionId: "action_monitor012345",
        command: {
          commandId: "cmd_monitor0123456789",
          idempotencyKey: "monitor-idempotency",
          capability: "power.onOff",
          target: { homeId: "home_primary", entityId: "ent_monitor0123456789" },
          input: { on: false },
          risk: "R1",
          dryRun: false,
        },
        expectedObservation: {
          entityId: "ent_monitor0123456789",
          attribute: "state",
          equals: "off",
          timeoutMs: 30_000,
        },
      },
    ],
    dryRun: false,
  };
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Condition was not reached");
}
