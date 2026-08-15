import { createRequire } from "node:module";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pingWorkflow } from "../ping.js";

const require = createRequire(import.meta.url);

describe("pingWorkflow", () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  it("survives a durable sleep and returns both marks", async () => {
    const taskQueue = "hestia-ping-test";
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: require.resolve("../workflows.ts"),
      activities: {
        async markAlive({ requestedBy }: { requestedBy: string }) {
          return {
            at: "2026-08-14T00:00:00.000Z",
            workerId: "test-worker",
            requestedBy,
          };
        },
      },
    });

    const result = await worker.runUntil(
      env.client.workflow.execute(pingWorkflow, {
        workflowId: "ping-test-1",
        taskQueue,
        args: [{ requestedBy: "phase-0", holdMs: 2000 }],
      }),
    );

    expect(result.holdMs).toBe(2000);
    expect(result.started.requestedBy).toBe("phase-0");
    expect(result.finished.workerId).toBe("test-worker");
  });
});
