import { createRequire } from "node:module";
import type {
  DeviceCommandResult,
  LeakIncidentInput,
  ProposedAction,
  TypedCommand,
} from "@hestia/contracts";
import { TaskQueues } from "@hestia/contracts";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  incidentAcknowledgedSignal,
  incidentResolvedSignal,
  incidentStateQuery,
  incidentWorkflow,
} from "../incident.js";

const require = createRequire(import.meta.url);

describe("incidentWorkflow", () => {
  let environment: TestWorkflowEnvironment;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await environment?.teardown();
  });

  it("mitigates, waits durably for acknowledgement, and preserves explicit closure", async () => {
    const trace: string[] = [];
    const scenario = await startScenario(environment, input([]), trace);
    try {
      await waitFor(
        async () =>
          (await scenario.handle.query(incidentStateQuery)).phase === "awaiting_acknowledgement",
      );
      await scenario.handle.signal(incidentAcknowledgedSignal, {
        principalId: "usr_owner_001",
        acknowledgedAt: "2026-08-16T10:01:00.000Z",
      });
      await scenario.handle.signal(incidentResolvedSignal, {
        status: "resolved",
        principalId: "usr_owner_001",
        resolvedAt: "2026-08-16T10:02:00.000Z",
        note: "Area inspected and dry",
      });
      const result = await scenario.handle.result();

      expect(result).toMatchObject({
        phase: "resolved",
        escalationStep: 0,
        acknowledgement: { principalId: "usr_owner_001" },
      });
      expect(trace).toContain("transition:incident.mitigated");
      expect(trace).toContain("transition:incident.resolved");
      expect(trace).not.toContain("transition:incident.escalated");
    } finally {
      await scenario.stop();
    }
  });

  it("uses a Temporal timer and changes channel when acknowledgement expires", async () => {
    const trace: string[] = [];
    const scenario = await startScenario(environment, input([], 1_000), trace);
    try {
      await waitFor(
        async () =>
          (await scenario.handle.query(incidentStateQuery)).phase === "awaiting_acknowledgement",
      );
      await environment.sleep(2_000);
      await waitFor(
        async () => (await scenario.handle.query(incidentStateQuery)).phase === "escalated",
      );
      await scenario.handle.signal(incidentAcknowledgedSignal, {
        principalId: "usr_owner_001",
        acknowledgedAt: "2026-08-16T10:05:00.000Z",
      });
      await scenario.handle.signal(incidentResolvedSignal, {
        status: "resolved",
        principalId: "usr_owner_001",
        resolvedAt: "2026-08-16T10:06:00.000Z",
        note: "Leak isolated",
      });
      const result = await scenario.handle.result();

      expect(result.escalationStep).toBe(1);
      expect(trace).toContain("delivery:external-webhook:1");
      expect(trace).toContain("transition:incident.escalated");
    } finally {
      await scenario.stop();
    }
  });

  it("compensates confirmed reversible steps when later mitigation fails", async () => {
    const trace: string[] = [];
    const actions = mitigationActions();
    const scenario = await startScenario(environment, input(actions), trace, async (command) => ({
      commandId: command.commandId,
      outcome: command.commandId === "cmd_close_valve_001" ? "timed_out" : "confirmed",
      executedAt: "2026-08-16T10:00:00.000Z",
      ...(command.commandId === "cmd_close_valve_001"
        ? {}
        : { confirmedAt: "2026-08-16T10:00:01.000Z" }),
    }));
    try {
      await waitFor(
        async () =>
          (await scenario.handle.query(incidentStateQuery)).phase === "awaiting_acknowledgement",
      );
      await scenario.handle.signal(incidentAcknowledgedSignal, {
        principalId: "usr_owner_001",
        acknowledgedAt: "2026-08-16T10:01:00.000Z",
      });
      await scenario.handle.signal(incidentResolvedSignal, {
        status: "resolved",
        principalId: "usr_owner_001",
        resolvedAt: "2026-08-16T10:02:00.000Z",
        note: "Manual valve closure confirmed",
      });
      const result = await scenario.handle.result();

      expect(result.actions.map((action) => action.status)).toEqual(["compensated", "failed"]);
      expect(trace).toEqual(
        expect.arrayContaining([
          "device:cmd_cut_power_001",
          "device:cmd_close_valve_001",
          "device:cmd_restore_power_001",
          "event:incident.mitigation.partial_failure",
        ]),
      );
    } finally {
      await scenario.stop();
    }
  });
});

async function startScenario(
  environment: TestWorkflowEnvironment,
  workflowInput: LeakIncidentInput,
  trace: string[],
  execute: (command: TypedCommand) => Promise<DeviceCommandResult> = async (command) => ({
    commandId: command.commandId,
    outcome: "confirmed",
    executedAt: "2026-08-16T10:00:00.000Z",
    confirmedAt: "2026-08-16T10:00:01.000Z",
  }),
) {
  const notificationWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TaskQueues.notifications,
    workflowsPath: require.resolve("../workflows.ts"),
    activities: {
      async createIncidentRecord() {
        trace.push("incident:created");
        return { incidentId: "inc_workflow_test_001", deduplicated: false };
      },
      async appendIncidentEvent(value: { eventType: string }) {
        trace.push(`event:${value.eventType}`);
      },
      async transitionIncidentRecord(value: { eventType: string }) {
        trace.push(`transition:${value.eventType}`);
      },
      async deliverIncidentNotification(value: { channel: string; escalationStep: number }) {
        trace.push(`delivery:${value.channel}:${value.escalationStep}`);
      },
    },
  });
  const policyWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TaskQueues.automation,
    activities: {
      async evaluateCommandPolicy() {
        return { effect: "allow", risk: "R3", reasons: ["published playbook"] } as const;
      },
    },
  });
  const deviceWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TaskQueues.deviceIo,
    activities: {
      async executeHomeAssistantCommand(command: TypedCommand) {
        trace.push(`device:${command.commandId}`);
        return execute(command);
      },
    },
  });
  const workers = [notificationWorker, policyWorker, deviceWorker];
  const runs = workers.map((worker) => worker.run());
  const handle = await environment.client.workflow.start(incidentWorkflow, {
    workflowId: `incident-workflow-test-${globalThis.crypto.randomUUID()}`,
    taskQueue: TaskQueues.notifications,
    args: [workflowInput],
  });
  return {
    handle,
    async stop() {
      for (const worker of workers) worker.shutdown();
      await Promise.all(runs);
    },
  };
}

function input(actions: ProposedAction[], acknowledgementTimeoutMs = 30_000): LeakIncidentInput {
  return {
    evidence: {
      eventId: "evt_incident_workflow_001",
      homeId: "home_primary",
      correlationId: "corr_incident_workflow_001",
      occurredAt: "2026-08-16T10:00:00.000Z",
      sensor: {
        entityId: "ent_leak_sensor_001",
        name: "Utility room leak sensor",
        deviceClass: "moisture",
        observedValue: "on",
        source: "home_assistant:ha_main",
      },
    },
    playbook: {
      playbookId: "playbook_leak_workflow_001",
      version: 1,
      homeId: "home_primary",
      name: "Leak mitigation test",
      status: "published",
      triggerDeviceClass: "moisture",
      preauthorized: true,
      mode: "active",
      acknowledgementTimeoutMs,
      actions,
      publishedAt: "2026-08-16T09:00:00.000Z",
    },
  };
}

function mitigationActions(): ProposedAction[] {
  return [
    {
      actionId: "action_cut_power_001",
      command: command(
        "cmd_cut_power_001",
        "power.onOff",
        "ent_pump_power_001",
        { on: false },
        "R1",
      ),
      expectedObservation: observation("ent_pump_power_001", "off"),
      compensation: {
        command: command(
          "cmd_restore_power_001",
          "power.onOff",
          "ent_pump_power_001",
          { on: true },
          "R1",
        ),
        expectedObservation: observation("ent_pump_power_001", "on"),
      },
    },
    {
      actionId: "action_close_valve_001",
      command: command(
        "cmd_close_valve_001",
        "valve.setOpen",
        "ent_main_valve_001",
        { open: false },
        "R3",
      ),
      expectedObservation: observation("ent_main_valve_001", "closed"),
    },
  ];
}

function command(
  commandId: string,
  capability: TypedCommand["capability"],
  entityId: string,
  commandInput: Record<string, unknown>,
  risk: TypedCommand["risk"],
): TypedCommand {
  return {
    commandId,
    idempotencyKey: `${commandId}-idempotency`,
    capability,
    target: { homeId: "home_primary", entityId },
    input: commandInput,
    risk,
    dryRun: false,
  };
}

function observation(entityId: string, equals: string) {
  return { entityId, attribute: "state", equals, timeoutMs: 30_000 };
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition was not reached");
}
