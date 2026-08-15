import {
  ActionPlanSchema,
  ApprovalDecisionSchema,
  AutomationRunStateSchema,
  createId,
  SleepContextSchema,
  SleepPlanPreviewRequestSchema,
} from "@hestia/contracts";
import { APIError, api } from "encore.dev/api";
import { homecore, temporalbridge } from "~encore/clients";
import type {
  ActionPlanView,
  ApprovalDecisionView,
  AutomationAuditEventView,
  AutomationRunStateView,
  AutomationRunView,
  SleepPlanPreviewRequestView,
  SleepPlanPreviewView,
} from "../shared/contracts";
import {
  appendAudit,
  getPlan as findPlan,
  getRun as findRun,
  listAudit,
  savePlan,
  saveRun,
  updateRunState,
} from "./repository";
import { buildSleepPlan, NoSleepActionsError } from "./sleep-plan";

export const previewSleep = api(
  { method: "POST", path: "/internal/automation/homes/:homeId/plans/sleep/preview" },
  async (request: SleepPlanPreviewRequestView): Promise<SleepPlanPreviewView> => {
    const parsed = SleepPlanPreviewRequestSchema.safeParse(request);
    if (!parsed.success) throw APIError.invalidArgument("Invalid sleep-plan options");
    const context = SleepContextSchema.parse(
      await homecore.sleepContext({ homeId: request.homeId }),
    );
    try {
      const preview = buildSleepPlan(context, parsed.data);
      await savePlan(preview.plan);
      return asTransport<SleepPlanPreviewView>(preview);
    } catch (error) {
      if (error instanceof NoSleepActionsError) throw APIError.failedPrecondition(error.message);
      throw error;
    }
  },
);

export const publishPlan = api(
  { method: "POST", path: "/internal/automation/plans" },
  async (plan: ActionPlanView): Promise<ActionPlanView> =>
    asTransport<ActionPlanView>(await savePlan(ActionPlanSchema.parse(plan))),
);

export const getPlan = api(
  { method: "GET", path: "/internal/automation/plans/:planId/versions/:version" },
  async ({ planId, version }: { planId: string; version: number }): Promise<ActionPlanView> => {
    const plan = await findPlan(planId, version);
    if (!plan) throw APIError.notFound("Automation plan not found");
    return asTransport<ActionPlanView>(plan);
  },
);

export const startPlan = api(
  { method: "POST", path: "/internal/automation/plans/:planId/versions/:version/runs" },
  async ({
    planId,
    version,
    requestedBy,
  }: {
    planId: string;
    version: number;
    requestedBy?: string;
  }): Promise<{
    workflowId: string;
    runId: string;
    planId: string;
    version: number;
    startedAt: string;
    status: "running";
  }> => {
    const saved = await findPlan(planId, version);
    if (!saved) throw APIError.notFound("Automation plan not found");
    const plan = ActionPlanSchema.parse({
      ...saved,
      requestedBy: requestedBy ?? saved.requestedBy,
      createdAt: new Date().toISOString(),
    });
    const started = await temporalbridge.startActionPlan({ planJson: JSON.stringify(plan) });
    const startedAt = new Date().toISOString();
    await saveRun({ ...started, planId, version, startedAt, status: "proposed" });
    await appendAudit({
      eventId: createId("evt"),
      workflowId: started.workflowId,
      runId: started.runId,
      planId,
      eventType: "run.started",
      occurredAt: startedAt,
      actor: plan.requestedBy,
      details: { version, title: plan.title, actionCount: plan.actions.length },
    });
    return { ...started, planId, version, startedAt, status: "running" };
  },
);

export const getRun = api(
  { method: "GET", path: "/internal/automation/runs/:workflowId" },
  async ({
    workflowId,
  }: {
    workflowId: string;
  }): Promise<{
    workflowId: string;
    runId: string;
    planId: string;
    version: number;
    startedAt: string;
    status: string;
    finishedAt?: string;
    state: AutomationRunStateView;
  }> => {
    const run = await requireRun(workflowId);
    const response = await temporalbridge.actionPlanState({ workflowId });
    const state = AutomationRunStateSchema.parse(JSON.parse(response.stateJson));
    await updateRunState(workflowId, state);
    return asTransport<AutomationRunView>({
      ...run,
      status: state.status,
      ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
      state,
    });
  },
);

export const approveRun = api(
  { method: "POST", path: "/internal/automation/runs/:workflowId/approval" },
  async (request: ApprovalDecisionView): Promise<{ workflowId: string; accepted: true }> => {
    const decision = ApprovalDecisionSchema.parse(request);
    const run = await requireRun(request.workflowId);
    await temporalbridge.approveActionPlan({
      workflowId: request.workflowId,
      decisionJson: JSON.stringify(decision),
    });
    await appendAudit({
      eventId: createId("evt"),
      workflowId: request.workflowId,
      runId: run.runId,
      planId: run.planId,
      eventType: "approval.submitted",
      occurredAt: decision.decidedAt,
      actor: decision.decidedBy,
      details: { approvalId: decision.approvalId, approved: decision.approved },
    });
    return { workflowId: request.workflowId, accepted: true };
  },
);

export const cancelRun = api(
  { method: "POST", path: "/internal/automation/runs/:workflowId/cancel" },
  async ({
    workflowId,
  }: {
    workflowId: string;
  }): Promise<{ workflowId: string; accepted: true }> => {
    const run = await requireRun(workflowId);
    await temporalbridge.cancelActionPlan({ workflowId });
    await appendAudit({
      eventId: createId("evt"),
      workflowId,
      runId: run.runId,
      planId: run.planId,
      eventType: "cancel.requested",
      occurredAt: new Date().toISOString(),
      actor: "resident",
      details: {},
    });
    return { workflowId, accepted: true };
  },
);

export const runAudit = api(
  { method: "GET", path: "/internal/automation/runs/:workflowId/audit" },
  async ({
    workflowId,
  }: {
    workflowId: string;
  }): Promise<{ workflowId: string; events: AutomationAuditEventView[] }> => {
    await requireRun(workflowId);
    return asTransport({ workflowId, events: await listAudit(workflowId) });
  },
);

async function requireRun(workflowId: string) {
  const run = await findRun(workflowId);
  if (!run) throw APIError.notFound("Automation run not found");
  return run;
}

function asTransport<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
