import { describe, expect, it } from "vitest";
import { LeakPlaybookSchema } from "../incident.js";

describe("leak playbook contract", () => {
  it("allows a published preauthorized valve-close action", () => {
    expect(() => LeakPlaybookSchema.parse(playbook(false))).not.toThrow();
  });

  it("rejects valve opening and effectful test-mode actions", () => {
    const opening = playbook(true);
    expect(() => LeakPlaybookSchema.parse(opening)).toThrow(/only close valves/u);
    const testMode = playbook(false);
    testMode.mode = "test";
    expect(() => LeakPlaybookSchema.parse(testMode)).toThrow(/dry-run/u);
  });

  it("rejects unrelated physical capabilities", () => {
    const source = playbook(false);
    const action = source.actions[0];
    if (!action) throw new Error("test playbook action is missing");
    const unsafe = {
      ...source,
      actions: [
        {
          ...action,
          command: {
            ...action.command,
            capability: "cover.setPosition",
            input: { position: 0 },
          },
        },
      ],
    };
    expect(() => LeakPlaybookSchema.parse(unsafe)).toThrow(
      /only permits valve closure or power isolation/u,
    );
  });
});

function playbook(open: boolean) {
  return {
    playbookId: "playbook_leak_test_001",
    version: 1,
    homeId: "home_primary",
    name: "Close main water valve",
    status: "published" as const,
    triggerDeviceClass: "moisture" as const,
    preauthorized: true as const,
    mode: "active" as "active" | "test",
    acknowledgementTimeoutMs: 5_000,
    publishedAt: "2026-08-16T10:00:00.000Z",
    actions: [
      {
        actionId: "action_close_valve_001",
        command: {
          commandId: "cmd_close_valve_001",
          idempotencyKey: "close-main-valve-001",
          capability: "valve.setOpen" as const,
          target: { homeId: "home_primary", entityId: "ent_main_valve_001" },
          input: { open },
          risk: "R3" as const,
          dryRun: false,
        },
        expectedObservation: {
          entityId: "ent_main_valve_001",
          attribute: "state",
          equals: "closed",
          timeoutMs: 30_000,
        },
      },
    ],
  };
}
