import {
  type ActionPlan,
  ActionPlanSchema,
  ApprovalDecisionSchema,
  createId,
  type ReadinessCheck,
  SleepPlanPreviewRequestSchema,
} from "@hestia/contracts";
import { createServiceApp, HttpError } from "@hestia/service-runtime";
import type { Express } from "express";
import type { AutomationHomeGateway } from "./home.js";
import type { AutomationRunMonitor } from "./monitor.js";
import type { AutomationRepository } from "./repository.js";
import { buildSleepPlan, NoSleepActionsError } from "./sleep-plan.js";
import type { AutomationTemporalGateway } from "./temporal.js";

export function createAutomationApp(options: {
  repository: AutomationRepository;
  temporal?: AutomationTemporalGateway;
  home?: AutomationHomeGateway;
  monitor?: AutomationRunMonitor;
}): Express {
  return createServiceApp({
    service: "automation-service",
    readiness: async (): Promise<ReadinessCheck[]> => [
      {
        name: "temporal",
        status: options.temporal ? "ok" : "down",
        detail: options.temporal ? "client attached" : "workflow execution unavailable",
      },
    ],
    register(app) {
      app.post("/api/v1/plans/sleep/preview", async (request, response) => {
        if (!options.home) throw new HttpError(503, "Home context is not configured");
        const parsed = SleepPlanPreviewRequestSchema.safeParse(request.body);
        if (!parsed.success) throw new HttpError(400, "Invalid sleep-plan options");
        try {
          response.json(buildSleepPlan(await options.home.getSleepContext(), parsed.data));
        } catch (error) {
          if (error instanceof NoSleepActionsError) throw new HttpError(409, error.message);
          throw error;
        }
      });

      app.post("/api/v1/plans", async (request, response) => {
        const plan = parsePlan(request.body);
        await options.repository.savePlan(plan);
        response.status(201).json(plan);
      });

      app.get("/api/v1/plans/:planId/versions/:version", async (request, response) => {
        const plan = await findPlan(
          options.repository,
          request.params.planId,
          request.params.version,
        );
        response.json(plan);
      });

      app.post("/api/v1/plans/:planId/versions/:version/runs", async (request, response) => {
        const saved = await findPlan(
          options.repository,
          request.params.planId,
          request.params.version,
        );
        const requestedBy =
          typeof request.body?.requestedBy === "string" && request.body.requestedBy.length > 0
            ? request.body.requestedBy
            : saved.requestedBy;
        const plan = ActionPlanSchema.parse({
          ...saved,
          requestedBy,
          createdAt: new Date().toISOString(),
        });
        response.status(202).json(await startPlan(options, plan));
      });

      app.post("/api/v1/runs", async (request, response) => {
        const plan = parsePlan(request.body);
        await options.repository.savePlan(plan);
        response.status(202).json(await startPlan(options, plan));
      });

      app.get("/api/v1/runs/:workflowId", async (request, response) => {
        const temporal = requireTemporal(options.temporal);
        const workflowId = requireText(request.params.workflowId, "workflowId");
        const run = await options.repository.getRun(workflowId);
        if (!run) throw new HttpError(404, "Automation run not found");
        response.json({ ...run, state: await temporal.state(workflowId) });
      });

      app.get("/api/v1/runs/:workflowId/audit", async (request, response) => {
        const workflowId = requireText(request.params.workflowId, "workflowId");
        const run = await options.repository.getRun(workflowId);
        if (!run) throw new HttpError(404, "Automation run not found");
        response.json({ workflowId, events: await options.repository.listAudit(workflowId) });
      });

      app.post("/api/v1/runs/:workflowId/approval", async (request, response) => {
        const temporal = requireTemporal(options.temporal);
        const workflowId = requireText(request.params.workflowId, "workflowId");
        const decision = ApprovalDecisionSchema.safeParse(request.body);
        if (!decision.success) throw new HttpError(400, "Invalid approval decision");
        const run = await requireRun(options.repository, workflowId);
        await temporal.approve(workflowId, decision.data);
        await options.repository.appendAudit({
          eventId: createId("evt"),
          workflowId,
          runId: run.runId,
          planId: run.planId,
          eventType: "approval.submitted",
          occurredAt: decision.data.decidedAt,
          actor: decision.data.decidedBy,
          details: {
            approvalId: decision.data.approvalId,
            approved: decision.data.approved,
          },
        });
        response.status(202).json({ workflowId, accepted: true });
      });

      app.post("/api/v1/runs/:workflowId/cancel", async (request, response) => {
        const temporal = requireTemporal(options.temporal);
        const workflowId = requireText(request.params.workflowId, "workflowId");
        const run = await requireRun(options.repository, workflowId);
        await temporal.cancel(workflowId);
        await options.repository.appendAudit({
          eventId: createId("evt"),
          workflowId,
          runId: run.runId,
          planId: run.planId,
          eventType: "cancel.requested",
          occurredAt: new Date().toISOString(),
          actor: "resident",
          details: {},
        });
        response.status(202).json({ workflowId, accepted: true });
      });
    },
  });
}

async function startPlan(
  options: {
    repository: AutomationRepository;
    temporal?: AutomationTemporalGateway;
    monitor?: AutomationRunMonitor;
  },
  plan: ActionPlan,
) {
  const started = await requireTemporal(options.temporal).start(plan);
  const record = {
    ...started,
    planId: plan.planId,
    version: plan.version,
    startedAt: new Date().toISOString(),
    status: "proposed" as const,
  };
  await options.repository.saveRun(record);
  await options.repository.appendAudit({
    eventId: createId("evt"),
    workflowId: record.workflowId,
    runId: record.runId,
    planId: record.planId,
    eventType: "run.started",
    occurredAt: record.startedAt,
    actor: plan.requestedBy,
    details: { version: plan.version, title: plan.title, actionCount: plan.actions.length },
  });
  options.monitor?.track(record.workflowId);
  return { ...record, status: "running" as const };
}

async function requireRun(repository: AutomationRepository, workflowId: string) {
  const run = await repository.getRun(workflowId);
  if (!run) throw new HttpError(404, "Automation run not found");
  return run;
}

async function findPlan(
  repository: AutomationRepository,
  planIdInput: unknown,
  versionInput: unknown,
) {
  const planId = requireText(planIdInput, "planId");
  const version = Number(versionInput);
  if (!Number.isInteger(version) || version < 1) throw new HttpError(400, "Invalid plan version");
  const plan = await repository.getPlan(planId, version);
  if (!plan) throw new HttpError(404, "Automation plan not found");
  return plan;
}

function parsePlan(input: unknown): ActionPlan {
  const parsed = ActionPlanSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Invalid action plan");
  return parsed.data;
}

function requireTemporal(
  temporal: AutomationTemporalGateway | undefined,
): AutomationTemporalGateway {
  if (!temporal) throw new HttpError(503, "Temporal is not configured");
  return temporal;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length < 1)
    throw new HttpError(400, `${name} is required`);
  return value;
}
