import { loadEnv, resolveServicePort, ServicePorts } from "@hestia/config";
import {
  ActionPlanSchema,
  AgentClarificationSchema,
  ApprovalDecisionSchema,
  type ReadinessCheck,
  ResidentIntentRequestSchema,
  SleepPlanPreviewRequestSchema,
} from "@hestia/contracts";
import { listCapabilities } from "@hestia/domain";
import { evaluatePolicy } from "@hestia/policy";
import { createServiceApp } from "@hestia/service-runtime";
import type { Express } from "express";
import type { AgentGateway } from "./agent.js";
import type { AutomationGateway } from "./automation.js";
import type { HomeGateway } from "./home.js";
import type { TemporalGateway } from "./temporal.js";

export interface CreateEdgeAppOptions {
  temporal?: TemporalGateway;
  home?: HomeGateway;
  automation?: AutomationGateway;
  agent?: AgentGateway;
  origin?: string;
}

export function createEdgeApp(options: CreateEdgeAppOptions = {}): Express {
  const env = loadEnv();
  return createServiceApp({
    service: "edge-api",
    origin: options.origin ?? env.WEB_ORIGIN,
    readiness: async () => readiness(options.temporal, options.automation, options.agent),
    register(app) {
      app.get("/api/v1/meta", (_req, res) => {
        res.json({
          name: "HESTIA",
          version: "0.1.0",
          phase: "3-agentic-control",
          thesis: "Probabilistic intelligence above; deterministic execution below.",
          lanes: ["http", "nats", "temporal"],
        });
      });

      app.get("/api/v1/capabilities", (_req, res) => {
        res.json({ capabilities: listCapabilities() });
      });

      app.get("/api/v1/home/entities", async (_req, res) => {
        if (!options.home) {
          res.status(503).json({ error: "Home services are not configured" });
          return;
        }
        res.json(await options.home.listEntities());
      });

      app.get("/api/v1/home/topology", async (_req, res) => {
        if (!options.home) {
          res.status(503).json({ error: "Home services are not configured" });
          return;
        }
        res.json(await options.home.getTopology());
      });

      app.get("/api/v1/home/integration-status", async (_req, res) => {
        if (!options.home) {
          res.status(503).json({ error: "Home services are not configured" });
          return;
        }
        res.json(await options.home.getIntegrationStatus());
      });

      app.get("/api/v1/home/contexts/sleep", async (_req, res) => {
        if (!options.home) {
          res.status(503).json({ error: "Home services are not configured" });
          return;
        }
        res.json(await options.home.getSleepContext());
      });

      app.post("/api/v1/home/sync", async (_req, res) => {
        if (!options.home) {
          res.status(503).json({ error: "Home services are not configured" });
          return;
        }
        res.json(await options.home.syncHomeAssistant());
      });

      app.post("/api/v1/automations/plans", async (req, res) => {
        if (!options.automation) {
          res.status(503).json({ error: "Automation service is not configured" });
          return;
        }
        const parsed = ActionPlanSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid action plan" });
          return;
        }
        res.status(201).json(await options.automation.publish(parsed.data));
      });

      app.post("/api/v1/automations/plans/sleep/preview", async (req, res) => {
        if (!options.automation) {
          res.status(503).json({ error: "Automation service is not configured" });
          return;
        }
        const parsed = SleepPlanPreviewRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid sleep-plan options" });
          return;
        }
        res.json(await options.automation.previewSleepPlan(parsed.data));
      });

      app.post("/api/v1/automations/runs", async (req, res) => {
        if (!options.automation) {
          res.status(503).json({ error: "Automation service is not configured" });
          return;
        }
        const parsed = ActionPlanSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid action plan" });
          return;
        }
        res.status(202).json(await options.automation.start(parsed.data));
      });

      app.post("/api/v1/automations/plans/:planId/versions/:version/runs", async (req, res) => {
        if (!options.automation) {
          res.status(503).json({ error: "Automation service is not configured" });
          return;
        }
        const version = Number(req.params.version);
        if (!Number.isInteger(version) || version < 1) {
          res.status(400).json({ error: "Invalid plan version" });
          return;
        }
        const requestedBy =
          typeof req.body?.requestedBy === "string" ? req.body.requestedBy : undefined;
        res
          .status(202)
          .json(await options.automation.startPublished(req.params.planId, version, requestedBy));
      });

      app.get("/api/v1/automations/runs/:workflowId", async (req, res) => {
        if (!options.automation) {
          res.status(503).json({ error: "Automation service is not configured" });
          return;
        }
        res.json(await options.automation.getRun(req.params.workflowId));
      });

      app.get("/api/v1/automations/runs/:workflowId/audit", async (req, res) => {
        if (!options.automation) {
          res.status(503).json({ error: "Automation service is not configured" });
          return;
        }
        res.json(await options.automation.getAudit(req.params.workflowId));
      });

      app.post("/api/v1/automations/runs/:workflowId/approval", async (req, res) => {
        if (!options.automation) {
          res.status(503).json({ error: "Automation service is not configured" });
          return;
        }
        const decision = ApprovalDecisionSchema.safeParse(req.body);
        if (!decision.success) {
          res.status(400).json({ error: "Invalid approval decision" });
          return;
        }
        res
          .status(202)
          .json(await options.automation.approve(req.params.workflowId, decision.data));
      });

      app.post("/api/v1/automations/runs/:workflowId/cancel", async (req, res) => {
        if (!options.automation) {
          res.status(503).json({ error: "Automation service is not configured" });
          return;
        }
        res.status(202).json(await options.automation.cancel(req.params.workflowId));
      });

      app.post("/api/v1/intents/preview", async (req, res) => {
        if (!options.agent) {
          res.status(503).json({ error: "AI orchestrator is not configured" });
          return;
        }
        const parsed = ResidentIntentRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid resident intent" });
          return;
        }
        res.json(await options.agent.previewIntent(parsed.data));
      });

      app.post("/api/v1/intents/runs", async (req, res) => {
        if (!options.agent) {
          res.status(503).json({ error: "AI orchestrator is not configured" });
          return;
        }
        const parsed = ResidentIntentRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid resident intent" });
          return;
        }
        res.status(202).json(await options.agent.startIntent(parsed.data));
      });

      app.get("/api/v1/intents/runs/:workflowId", async (req, res) => {
        if (!options.agent) {
          res.status(503).json({ error: "AI orchestrator is not configured" });
          return;
        }
        res.json(await options.agent.getIntentRun(req.params.workflowId));
      });

      app.post("/api/v1/intents/runs/:workflowId/clarification", async (req, res) => {
        if (!options.agent) {
          res.status(503).json({ error: "AI orchestrator is not configured" });
          return;
        }
        const parsed = AgentClarificationSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid clarification" });
          return;
        }
        res.status(202).json(await options.agent.clarifyIntent(req.params.workflowId, parsed.data));
      });

      app.post("/api/v1/policy/evaluate", (req, res) => {
        const capability = req.body?.capability;
        if (typeof capability !== "string") {
          res.status(400).json({ error: "capability is required" });
          return;
        }
        try {
          res.json(
            evaluatePolicy({ capability: capability as never, dryRun: Boolean(req.body?.dryRun) }),
          );
        } catch (error) {
          res
            .status(400)
            .json({ error: error instanceof Error ? error.message : "invalid capability" });
        }
      });

      app.post("/api/v1/system/ping", async (req, res) => {
        if (!options.temporal) {
          res.status(503).json({ error: "Temporal is not configured" });
          return;
        }
        const requestedBy =
          typeof req.body?.requestedBy === "string" && req.body.requestedBy.length > 0
            ? req.body.requestedBy
            : "operator";
        const started = await options.temporal.startPing({ requestedBy });
        res.status(202).json({ ...started, status: "running" });
      });

      app.get("/api/v1/system/ping/:workflowId", async (req, res) => {
        if (!options.temporal) {
          res.status(503).json({ error: "Temporal is not configured" });
          return;
        }
        const workflowId = req.params.workflowId;
        if (!workflowId) {
          res.status(400).json({ error: "workflowId is required" });
          return;
        }
        try {
          res.json(await options.temporal.describePing(workflowId));
        } catch {
          res.status(404).json({ error: "Workflow not found" });
        }
      });
    },
  });
}

async function readiness(
  temporal: TemporalGateway | undefined,
  automation: AutomationGateway | undefined,
  agent: AgentGateway | undefined,
): Promise<ReadinessCheck[]> {
  return [
    {
      name: "temporal",
      status: temporal ? "ok" : "degraded",
      detail: temporal ? "client attached" : "no Temporal client in this process",
    },
    {
      name: "automation-service",
      status: automation ? "ok" : "degraded",
      detail: automation ? "gateway configured" : "automation routes unavailable",
    },
    {
      name: "ai-orchestrator",
      status: agent ? "ok" : "degraded",
      detail: agent ? "gateway configured" : "agentic planning unavailable",
    },
  ];
}

export function defaultEdgePort(): number {
  return resolveServicePort("EDGE_API_PORT", ServicePorts.edgeApi);
}
