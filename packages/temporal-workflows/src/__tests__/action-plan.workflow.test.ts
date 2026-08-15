import { createRequire } from "node:module";
import {
  type ActionPlan,
  type ApprovalDecision,
  TaskQueues,
  type TypedCommand,
} from "@hestia/contracts";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  actionPlanWorkflow,
  approvalDecisionSignal,
  automationStateQuery,
} from "../action-plan.js";

const require = createRequire(import.meta.url);

describe("actionPlanWorkflow", () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  it("waits durably for approval and confirms observed execution", async () => {
    const approvalId = "appr_sleep0123456789";
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TaskQueues.deviceIo,
      workflowsPath: require.resolve("../workflows.ts"),
      activities: {
        async evaluateCommandPolicy() {
          return { effect: "require_approval", risk: "R3", reasons: ["approval"], approvalId };
        },
        async executeHomeAssistantCommand(command: TypedCommand) {
          return {
            commandId: command.commandId,
            outcome: "confirmed",
            observedValue: "armed_away",
            executedAt: "2026-08-14T22:00:00.000Z",
            confirmedAt: "2026-08-14T22:00:01.000Z",
          } as const;
        },
      },
    });
    const handle = await env.client.workflow.start(actionPlanWorkflow, {
      workflowId: "action-plan-approval-test",
      taskQueue: TaskQueues.deviceIo,
      args: [plan("security.arm", "armed_away")],
    });
    const approval: ApprovalDecision = {
      approvalId,
      approved: true,
      decidedBy: "operator",
      decidedAt: "2026-08-14T22:00:00.000Z",
    };

    await handle.signal(approvalDecisionSignal, approval);
    const result = await worker.runUntil(handle.result());

    expect(result.status).toBe("completed");
    expect(result.actions[0]?.status).toBe("confirmed");
    expect(result.approval?.decidedBy).toBe("operator");
  });

  it("exposes progress through a workflow query", async () => {
    let releaseExecution: (() => void) | undefined;
    const executionGate = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TaskQueues.deviceIo,
      workflowsPath: require.resolve("../workflows.ts"),
      activities: {
        async evaluateCommandPolicy() {
          return { effect: "allow", risk: "R1", reasons: ["allowed"] };
        },
        async executeHomeAssistantCommand(command: TypedCommand) {
          await executionGate;
          return {
            commandId: command.commandId,
            outcome: "confirmed",
            observedValue: "off",
            executedAt: "2026-08-14T22:00:00.000Z",
          } as const;
        },
      },
    });
    const handle = await env.client.workflow.start(actionPlanWorkflow, {
      workflowId: "action-plan-query-test",
      taskQueue: TaskQueues.deviceIo,
      args: [plan("power.onOff", "off")],
    });
    const running = worker.runUntil(handle.result());
    await waitFor(async () => (await handle.query(automationStateQuery)).status === "verifying");
    expect((await handle.query(automationStateQuery)).actions[0]?.status).toBe("executing");
    releaseExecution?.();
    expect((await running).status).toBe("completed");
  });

  it("compensates completed actions in reverse when a later observation fails", async () => {
    const base = plan("power.onOff", "off");
    const first = base.actions[0];
    if (!first) throw new Error("fixture requires an action");
    first.compensation = {
      command: {
        ...first.command,
        commandId: "cmd_compensation012345",
        idempotencyKey: "workflow-compensation-idem",
        input: { on: true },
      },
      expectedObservation: { ...first.expectedObservation, equals: "on" },
    };
    base.actions.push({
      actionId: "action_second012345",
      command: {
        ...first.command,
        commandId: "cmd_second0123456789",
        idempotencyKey: "workflow-second-idem",
      },
      expectedObservation: { ...first.expectedObservation },
    });
    const calls: string[] = [];
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TaskQueues.deviceIo,
      workflowsPath: require.resolve("../workflows.ts"),
      activities: {
        async evaluateCommandPolicy() {
          return { effect: "allow", risk: "R1", reasons: ["allowed"] };
        },
        async executeHomeAssistantCommand(command: TypedCommand) {
          calls.push(command.commandId);
          return {
            commandId: command.commandId,
            outcome: command.commandId === "cmd_second0123456789" ? "timed_out" : "confirmed",
            executedAt: "2026-08-14T22:00:00.000Z",
          } as const;
        },
      },
    });

    const result = await worker.runUntil(
      env.client.workflow.execute(actionPlanWorkflow, {
        workflowId: "action-plan-compensation-test",
        taskQueue: TaskQueues.deviceIo,
        args: [base],
      }),
    );

    expect(result.status).toBe("compensated");
    expect(result.actions[0]?.status).toBe("compensated");
    expect(calls).toEqual(["cmd_test0123456789", "cmd_second0123456789", "cmd_compensation012345"]);
  });
});

function plan(capability: "power.onOff" | "security.arm", expected: string): ActionPlan {
  return {
    planId: `plan_${capability.replaceAll(".", "_")}0123456789`,
    version: 1,
    homeId: "home_primary",
    title: "Workflow test",
    requestedBy: "operator",
    createdAt: "2026-08-14T22:00:00.000Z",
    actions: [
      {
        actionId: "action_test0123456789",
        command: {
          commandId: "cmd_test0123456789",
          idempotencyKey: "workflow-test-idempotency",
          capability,
          target: { homeId: "home_primary", entityId: "ent_test0123456789" },
          input: capability === "power.onOff" ? { on: false } : {},
          risk: capability === "security.arm" ? "R3" : "R1",
          dryRun: false,
        },
        expectedObservation: {
          entityId: "ent_test0123456789",
          attribute: "state",
          equals: expected,
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
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition was not reached");
}
