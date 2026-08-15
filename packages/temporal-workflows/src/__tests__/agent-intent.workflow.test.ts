import { createRequire } from "node:module";
import { TaskQueues } from "@hestia/contracts";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agentClarificationSignal,
  agentIntentStateQuery,
  agentIntentWorkflow,
} from "../agent-intent.js";

const require = createRequire(import.meta.url);

describe("agentIntentWorkflow", () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  it("waits durably for clarification and then returns a visible plan", async () => {
    let interpretations = 0;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TaskQueues.ai,
      workflowsPath: require.resolve("../workflows.ts"),
      activities: {
        async interpretResidentIntent() {
          interpretations += 1;
          return interpretations === 1
            ? {
                kind: "unsupported" as const,
                confidence: 0.4,
                summary: "Please clarify",
                sleep: null,
              }
            : {
                kind: "sleep" as const,
                confidence: 0.96,
                summary: "Prepare for sleep",
                sleep: { climateTargetC: 18, closeCovers: true, armAlarm: false },
              };
        },
        async previewInterpretedSleepIntent() {
          return previewFixture();
        },
      },
    });
    const workerRun = worker.run();
    const handle = await env.client.workflow.start(agentIntentWorkflow, {
      workflowId: "agent-intent-clarification-test",
      taskQueue: TaskQueues.ai,
      args: [{ utterance: "Make it comfortable", requestedBy: "resident" }],
    });
    await waitFor(
      async () => (await handle.query(agentIntentStateQuery)).status === "awaiting_clarification",
    );
    await handle.signal(agentClarificationSignal, {
      text: "I am going to sleep",
      providedBy: "resident",
    });

    const completed = await handle.result();
    expect(completed.status).toBe("completed");
    expect(completed.attempt).toBe(2);
    expect(completed.preview?.plan.title).toBe("Go to sleep");
    worker.shutdown();
    await workerRun;
  });
});

function previewFixture() {
  return {
    plan: {
      planId: "plan_agent_workflow012345",
      version: 1,
      homeId: "home_primary",
      title: "Go to sleep",
      requestedBy: "resident",
      createdAt: "2026-08-14T20:00:00.000Z",
      dryRun: false,
      actions: [
        {
          actionId: "action_agent_workflow012345",
          command: {
            commandId: "cmd_agent_workflow012345",
            idempotencyKey: "agent-workflow-idempotency",
            capability: "power.onOff" as const,
            target: { homeId: "home_primary", entityId: "ent_agent_workflow012345" },
            input: { on: false },
            risk: "R1" as const,
            dryRun: false,
          },
          expectedObservation: {
            entityId: "ent_agent_workflow012345",
            attribute: "state",
            equals: "off",
            timeoutMs: 30_000,
          },
        },
      ],
    },
    skipped: [],
  };
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition was not reached");
}
