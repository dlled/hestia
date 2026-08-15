import { type AutomationRunState, createId } from "@hestia/contracts";
import type { AutomationRepository } from "./repository.js";
import { isTerminal } from "./repository.js";
import type { AutomationTemporalGateway } from "./temporal.js";

export interface AutomationRunMonitor {
  track(workflowId: string): void;
  close(): Promise<void>;
}

export function createAutomationRunMonitor(options: {
  repository: AutomationRepository;
  temporal: AutomationTemporalGateway;
  pollMs?: number;
  onError?: (error: unknown, workflowId: string) => void;
}): AutomationRunMonitor {
  const active = new Map<string, Promise<void>>();
  let stopping = false;
  const pollMs = options.pollMs ?? 500;

  return {
    track(workflowId) {
      if (stopping || active.has(workflowId)) return;
      const running = monitor(workflowId).finally(() => active.delete(workflowId));
      active.set(workflowId, running);
    },
    async close() {
      stopping = true;
      await Promise.allSettled(active.values());
    },
  };

  async function monitor(workflowId: string): Promise<void> {
    const run = await options.repository.getRun(workflowId);
    if (!run) return;
    let previous = "";
    while (!stopping) {
      try {
        const state = await options.temporal.state(workflowId);
        await options.repository.updateRunState(workflowId, state);
        const next = fingerprint(state);
        if (next !== previous) {
          previous = next;
          await options.repository.appendAudit({
            eventId: createId("evt"),
            workflowId,
            runId: run.runId,
            planId: run.planId,
            eventType: "run.state.changed",
            occurredAt: new Date().toISOString(),
            actor: "temporal",
            details: {
              status: state.status,
              currentAction: state.currentAction,
              actions: state.actions.map((action) => ({
                actionId: action.actionId,
                commandId: action.commandId,
                status: action.status,
                ...(action.policy ? { policy: action.policy } : {}),
                ...(action.error ? { error: action.error } : {}),
              })),
              ...(state.pendingApprovalId ? { pendingApprovalId: state.pendingApprovalId } : {}),
            },
          });
        }
        if (isTerminal(state.status)) return;
      } catch (error) {
        options.onError?.(error, workflowId);
      }
      await delay(pollMs);
    }
  }
}

function fingerprint(state: AutomationRunState): string {
  return JSON.stringify({
    status: state.status,
    currentAction: state.currentAction,
    pendingApprovalId: state.pendingApprovalId,
    approval: state.approval,
    actions: state.actions.map((action) => ({
      actionId: action.actionId,
      status: action.status,
      policy: action.policy,
      observedValue: action.observedValue,
      error: action.error,
    })),
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
