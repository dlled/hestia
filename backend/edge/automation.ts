import { api } from "encore.dev/api";
import { automation, policy, temporalbridge } from "~encore/clients";
import type {
  ActionPlanView,
  ApprovalDecisionView,
  AutomationAuditEventView,
  AutomationRunView,
  EvaluatePolicyRequest,
  PolicyDecisionView,
  SleepPlanPreviewRequestView,
  SleepPlanPreviewView,
} from "../shared/contracts";

export const previewSleepPlan = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/homes/:homeId/plans/sleep/preview" },
  async (request: SleepPlanPreviewRequestView): Promise<SleepPlanPreviewView> =>
    automation.previewSleep(request),
);

export const publishAutomationPlan = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/plans" },
  async (plan: ActionPlanView): Promise<ActionPlanView> => automation.publishPlan(plan),
);

export const getAutomationPlan = api(
  { expose: true, method: "GET", path: "/api/v1/plans/:planId/versions/:version" },
  async ({ planId, version }: { planId: string; version: number }): Promise<ActionPlanView> =>
    automation.getPlan({ planId, version }),
);

export const startAutomationPlan = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/plans/:planId/versions/:version/runs",
  },
  async (request: {
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
  }> => automation.startPlan(request),
);

export const getAutomationRun = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/runs/:workflowId" },
  async ({ workflowId }: { workflowId: string }): Promise<AutomationRunView> =>
    automation.getRun({ workflowId }),
);

export const approveAutomationRun = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/runs/:workflowId/approval" },
  async (request: ApprovalDecisionView): Promise<{ workflowId: string; accepted: true }> =>
    automation.approveRun(request),
);

export const cancelAutomationRun = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/runs/:workflowId/cancel" },
  async ({ workflowId }: { workflowId: string }): Promise<{ workflowId: string; accepted: true }> =>
    automation.cancelRun({ workflowId }),
);

export const getAutomationRunAudit = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/runs/:workflowId/audit" },
  async ({
    workflowId,
  }: {
    workflowId: string;
  }): Promise<{ workflowId: string; events: AutomationAuditEventView[] }> =>
    automation.runAudit({ workflowId }),
);

export const evaluatePolicy = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/policy/evaluate" },
  async (request: EvaluatePolicyRequest): Promise<PolicyDecisionView> => policy.evaluate(request),
);

export const temporalStatus = api(
  { expose: true, method: "GET", path: "/api/v1/temporal/status" },
  async (): Promise<{ engine: "temporal"; ownership: "external"; taskQueue: string }> =>
    temporalbridge.status(),
);
