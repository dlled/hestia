import {
  type ActionPlan,
  ActionPlanSchema,
  type AutomationAuditEvent,
  AutomationAuditEventSchema,
  type AutomationRunState,
  type AutomationRunStatus,
} from "@hestia/contracts";
import pg from "pg";

const { Pool } = pg;

export interface AutomationRunRecord {
  workflowId: string;
  runId: string;
  planId: string;
  version: number;
  startedAt: string;
  status: AutomationRunStatus;
  finishedAt?: string;
}

export type NewAutomationAuditEvent = Omit<AutomationAuditEvent, "sequence">;

export interface AutomationRepository {
  ensureSchema(): Promise<void>;
  savePlan(plan: ActionPlan): Promise<void>;
  getPlan(planId: string, version: number): Promise<ActionPlan | undefined>;
  saveRun(run: AutomationRunRecord): Promise<void>;
  getRun(workflowId: string): Promise<AutomationRunRecord | undefined>;
  listActiveRuns(): Promise<AutomationRunRecord[]>;
  updateRunState(workflowId: string, state: AutomationRunState): Promise<void>;
  appendAudit(event: NewAutomationAuditEvent): Promise<AutomationAuditEvent>;
  listAudit(workflowId: string): Promise<AutomationAuditEvent[]>;
  close(): Promise<void>;
}

export function createMemoryAutomationRepository(): AutomationRepository {
  const plans = new Map<string, ActionPlan>();
  const runs = new Map<string, AutomationRunRecord>();
  const audit: AutomationAuditEvent[] = [];
  let sequence = 0;
  return {
    async ensureSchema() {},
    async savePlan(input) {
      const plan = ActionPlanSchema.parse(input);
      plans.set(planKey(plan.planId, plan.version), plan);
    },
    async getPlan(planId, version) {
      return plans.get(planKey(planId, version));
    },
    async saveRun(run) {
      runs.set(run.workflowId, run);
    },
    async getRun(workflowId) {
      return runs.get(workflowId);
    },
    async listActiveRuns() {
      return [...runs.values()].filter((run) => !isTerminal(run.status));
    },
    async updateRunState(workflowId, state) {
      const run = runs.get(workflowId);
      if (!run) return;
      runs.set(workflowId, {
        ...run,
        status: state.status,
        ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
      });
    },
    async appendAudit(input) {
      sequence += 1;
      const event = AutomationAuditEventSchema.parse({ ...input, sequence });
      audit.push(event);
      return event;
    },
    async listAudit(workflowId) {
      return audit.filter((event) => event.workflowId === workflowId);
    },
    async close() {
      plans.clear();
      runs.clear();
      audit.length = 0;
    },
  };
}

export function createPostgresAutomationRepository(databaseUrl: string): AutomationRepository {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return {
    async ensureSchema() {
      await pool.query(`
        CREATE SCHEMA IF NOT EXISTS automation_service;
        CREATE TABLE IF NOT EXISTS automation_service.plans (
          plan_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (plan_id, version)
        );
        CREATE TABLE IF NOT EXISTS automation_service.runs (
          workflow_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          started_at TIMESTAMPTZ NOT NULL,
          status TEXT NOT NULL DEFAULT 'proposed',
          finished_at TIMESTAMPTZ,
          last_state JSONB,
          FOREIGN KEY (plan_id, version)
            REFERENCES automation_service.plans (plan_id, version)
        );
        CREATE INDEX IF NOT EXISTS automation_runs_plan_idx
          ON automation_service.runs (plan_id, version, started_at DESC);
        ALTER TABLE automation_service.runs
          ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'proposed';
        ALTER TABLE automation_service.runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
        ALTER TABLE automation_service.runs ADD COLUMN IF NOT EXISTS last_state JSONB;
        CREATE TABLE IF NOT EXISTS automation_service.audit_events (
          sequence BIGSERIAL PRIMARY KEY,
          event_id TEXT NOT NULL UNIQUE,
          workflow_id TEXT NOT NULL REFERENCES automation_service.runs (workflow_id),
          run_id TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          occurred_at TIMESTAMPTZ NOT NULL,
          actor TEXT NOT NULL,
          details JSONB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS automation_audit_workflow_idx
          ON automation_service.audit_events (workflow_id, sequence);
      `);
    },
    async savePlan(input) {
      const plan = ActionPlanSchema.parse(input);
      await pool.query(
        `INSERT INTO automation_service.plans (plan_id, version, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (plan_id, version) DO UPDATE SET payload = EXCLUDED.payload`,
        [plan.planId, plan.version, JSON.stringify(plan)],
      );
    },
    async getPlan(planId, version) {
      const result = await pool.query<{ payload: unknown }>(
        `SELECT payload FROM automation_service.plans WHERE plan_id = $1 AND version = $2`,
        [planId, version],
      );
      const row = result.rows[0];
      return row ? ActionPlanSchema.parse(row.payload) : undefined;
    },
    async saveRun(run) {
      await pool.query(
        `INSERT INTO automation_service.runs
          (workflow_id, run_id, plan_id, version, started_at, status, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          run.workflowId,
          run.runId,
          run.planId,
          run.version,
          run.startedAt,
          run.status,
          run.finishedAt ?? null,
        ],
      );
    },
    async getRun(workflowId) {
      const result = await pool.query<{
        workflow_id: string;
        run_id: string;
        plan_id: string;
        version: number;
        started_at: Date;
        status: AutomationRunStatus;
        finished_at: Date | null;
      }>(
        `SELECT workflow_id, run_id, plan_id, version, started_at, status, finished_at
         FROM automation_service.runs WHERE workflow_id = $1`,
        [workflowId],
      );
      const row = result.rows[0];
      return row
        ? {
            workflowId: row.workflow_id,
            runId: row.run_id,
            planId: row.plan_id,
            version: row.version,
            startedAt: row.started_at.toISOString(),
            status: row.status,
            ...(row.finished_at ? { finishedAt: row.finished_at.toISOString() } : {}),
          }
        : undefined;
    },
    async listActiveRuns() {
      const result = await pool.query<{ workflow_id: string }>(
        `SELECT workflow_id FROM automation_service.runs
         WHERE status NOT IN ('completed', 'rejected', 'failed', 'compensated', 'cancelled', 'timed_out')
         ORDER BY started_at ASC`,
      );
      const runs = await Promise.all(result.rows.map((row) => this.getRun(row.workflow_id)));
      return runs.filter((run): run is AutomationRunRecord => run !== undefined);
    },
    async updateRunState(workflowId, state) {
      await pool.query(
        `UPDATE automation_service.runs
         SET status = $2, finished_at = $3, last_state = $4
         WHERE workflow_id = $1`,
        [workflowId, state.status, state.finishedAt ?? null, JSON.stringify(state)],
      );
    },
    async appendAudit(input) {
      const result = await pool.query<{
        sequence: number;
        event_id: string;
        workflow_id: string;
        run_id: string;
        plan_id: string;
        event_type: AutomationAuditEvent["eventType"];
        occurred_at: Date;
        actor: string;
        details: Record<string, unknown>;
      }>(
        `INSERT INTO automation_service.audit_events
          (event_id, workflow_id, run_id, plan_id, event_type, occurred_at, actor, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING sequence::int, event_id, workflow_id, run_id, plan_id, event_type,
                   occurred_at, actor, details`,
        [
          input.eventId,
          input.workflowId,
          input.runId,
          input.planId,
          input.eventType,
          input.occurredAt,
          input.actor,
          JSON.stringify(input.details),
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Audit insert did not return a row");
      return AutomationAuditEventSchema.parse({
        sequence: row.sequence,
        eventId: row.event_id,
        workflowId: row.workflow_id,
        runId: row.run_id,
        planId: row.plan_id,
        eventType: row.event_type,
        occurredAt: row.occurred_at.toISOString(),
        actor: row.actor,
        details: row.details,
      });
    },
    async listAudit(workflowId) {
      const result = await pool.query<{
        sequence: number;
        event_id: string;
        workflow_id: string;
        run_id: string;
        plan_id: string;
        event_type: AutomationAuditEvent["eventType"];
        occurred_at: Date;
        actor: string;
        details: Record<string, unknown>;
      }>(
        `SELECT sequence::int, event_id, workflow_id, run_id, plan_id, event_type,
                occurred_at, actor, details
         FROM automation_service.audit_events
         WHERE workflow_id = $1 ORDER BY sequence ASC`,
        [workflowId],
      );
      return result.rows.map((row) =>
        AutomationAuditEventSchema.parse({
          sequence: row.sequence,
          eventId: row.event_id,
          workflowId: row.workflow_id,
          runId: row.run_id,
          planId: row.plan_id,
          eventType: row.event_type,
          occurredAt: row.occurred_at.toISOString(),
          actor: row.actor,
          details: row.details,
        }),
      );
    },
    async close() {
      await pool.end();
    },
  };
}

const terminalStatuses = new Set<AutomationRunStatus>([
  "completed",
  "rejected",
  "failed",
  "compensated",
  "cancelled",
  "timed_out",
]);

export function isTerminal(status: AutomationRunStatus): boolean {
  return terminalStatuses.has(status);
}

function planKey(planId: string, version: number): string {
  return `${planId}:${version}`;
}
