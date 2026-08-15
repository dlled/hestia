import {
  type ActionPlan,
  ActionPlanSchema,
  type ProposedAction,
  type SleepContext,
  type SleepContextItem,
  type SleepPlanPreview,
  type SleepPlanPreviewRequest,
  SleepPlanPreviewRequestSchema,
  SleepPlanPreviewSchema,
} from "@hestia/contracts";

export class NoSleepActionsError extends Error {}

export function buildSleepPlan(
  context: SleepContext,
  requestInput: SleepPlanPreviewRequest,
): SleepPlanPreview {
  const request = SleepPlanPreviewRequestSchema.parse(requestInput);
  const actions: ProposedAction[] = [];
  const skipped: SleepPlanPreview["skipped"] = [];

  for (const item of context.categories.lights) {
    if (!ready(item, skipped) || item.observedState.value === "off") continue;
    actions.push(
      action(context.homeId, item, "power.onOff", { on: false }, "R1", "off", {
        capability: "power.onOff",
        input: { on: true },
        risk: "R1",
        expected: "on",
      }),
    );
  }
  for (const item of context.categories.climate) {
    if (!ready(item, skipped)) continue;
    actions.push(
      action(
        context.homeId,
        item,
        "climate.setTarget",
        { temperature: request.climateTargetC },
        "R2",
        request.climateTargetC,
        undefined,
        "temperature",
      ),
    );
  }
  if (request.closeCovers) {
    for (const item of context.categories.covers) {
      if (!ready(item, skipped) || item.observedState.value === "closed") continue;
      actions.push(
        action(context.homeId, item, "cover.setPosition", { position: 0 }, "R2", "closed"),
      );
    }
  }
  for (const item of context.categories.media) {
    if (!ready(item, skipped) || !["on", "playing"].includes(String(item.observedState.value)))
      continue;
    actions.push(
      action(context.homeId, item, "media.pause", {}, "R1", "paused", {
        capability: "media.play",
        input: {},
        risk: "R1",
        expected: "playing",
      }),
    );
  }
  if (request.armAlarm) {
    for (const item of context.categories.alarm) {
      if (!ready(item, skipped) || String(item.observedState.value).startsWith("armed_")) continue;
      actions.push(action(context.homeId, item, "security.arm", {}, "R3", "armed_away"));
    }
  }

  if (actions.length === 0)
    throw new NoSleepActionsError("The observed home is already in the requested sleep state");
  const plan: ActionPlan = ActionPlanSchema.parse({
    planId: id("plan"),
    version: 1,
    homeId: context.homeId,
    title: "Go to sleep",
    requestedBy: request.requestedBy,
    createdAt: new Date().toISOString(),
    actions: actions.map((candidate) => ({
      ...candidate,
      command: { ...candidate.command, dryRun: request.dryRun },
      ...(candidate.compensation
        ? {
            compensation: {
              ...candidate.compensation,
              command: { ...candidate.compensation.command, dryRun: request.dryRun },
            },
          }
        : {}),
    })),
    dryRun: request.dryRun,
  });
  return SleepPlanPreviewSchema.parse({ plan, skipped });
}

function action(
  homeId: string,
  item: SleepContextItem,
  capability: ProposedAction["command"]["capability"],
  input: Record<string, unknown>,
  risk: ProposedAction["command"]["risk"],
  expected: unknown,
  compensation?: {
    capability: ProposedAction["command"]["capability"];
    input: Record<string, unknown>;
    risk: ProposedAction["command"]["risk"];
    expected: unknown;
  },
  attribute = "state",
): ProposedAction {
  return {
    actionId: id("action"),
    command: {
      commandId: id("cmd"),
      idempotencyKey: id("idem"),
      capability,
      target: { homeId, entityId: item.entityId },
      input,
      risk,
      dryRun: false,
    },
    expectedObservation: {
      entityId: item.entityId,
      attribute,
      equals: expected,
      timeoutMs: 30_000,
    },
    ...(compensation
      ? {
          compensation: {
            command: {
              commandId: id("cmd"),
              idempotencyKey: id("idem"),
              capability: compensation.capability,
              target: { homeId, entityId: item.entityId },
              input: compensation.input,
              risk: compensation.risk,
              dryRun: false,
            },
            expectedObservation: {
              entityId: item.entityId,
              attribute: "state",
              equals: compensation.expected,
              timeoutMs: 30_000,
            },
          },
        }
      : {}),
  };
}

function ready(item: SleepContextItem, skipped: SleepPlanPreview["skipped"]): boolean {
  if (item.attention === "ready") return true;
  skipped.push({
    entityId: item.entityId,
    name: item.name,
    reason: `Observed state is ${item.attention}; no command was proposed`,
  });
  return false;
}

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
