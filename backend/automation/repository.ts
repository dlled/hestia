import {
  type ActionPlan,
  ActionPlanSchema,
  type AutomationAuditEvent,
  AutomationAuditEventSchema,
  type AutomationRunState,
  AutomationRunStateSchema,
  type AutomationRunStatus,
} from "@hestia/contracts";
import { automationDB } from "./db";

export interface AutomationRunRecord {
  workflowId: string;
  runId: string;
  planId: string;
  version: number;
  startedAt: string;
  status: AutomationRunStatus;
  finishedAt?: string;
}

export async function savePlan(input: ActionPlan): Promise<ActionPlan> {
  const plan = ActionPlanSchema.parse(input);
  await automationDB.exec`
    INSERT INTO action_plan (plan_id, version, payload, created_at)
    VALUES (${plan.planId}, ${plan.version}, ${plan as Record<string, unknown>}, ${new Date(plan.createdAt)})
    ON CONFLICT (plan_id, version) DO UPDATE SET payload = EXCLUDED.payload
  `;
  return plan;
}

export async function getPlan(planId: string, version: number): Promise<ActionPlan | undefined> {
  const row = await automationDB.queryRow<{ payload: unknown }>`
    SELECT payload FROM action_plan WHERE plan_id = ${planId} AND version = ${version}
  `;
  return row ? ActionPlanSchema.parse(row.payload) : undefined;
}

export async function saveRun(run: AutomationRunRecord): Promise<void> {
  await automationDB.exec`
    INSERT INTO automation_run (workflow_id, run_id, plan_id, version, started_at, status, finished_at)
    VALUES (
      ${run.workflowId}, ${run.runId}, ${run.planId}, ${run.version},
      ${new Date(run.startedAt)}, ${run.status}, ${run.finishedAt ? new Date(run.finishedAt) : null}
    )
  `;
}

export async function getRun(workflowId: string): Promise<AutomationRunRecord | undefined> {
  const row = await automationDB.queryRow<{
    workflow_id: string;
    run_id: string;
    plan_id: string;
    version: number;
    started_at: Date;
    status: AutomationRunStatus;
    finished_at: Date | null;
  }>`
    SELECT workflow_id, run_id, plan_id, version, started_at, status, finished_at
    FROM automation_run WHERE workflow_id = ${workflowId}
  `;
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
}

export async function updateRunState(workflowId: string, input: AutomationRunState): Promise<void> {
  const state = AutomationRunStateSchema.parse(input);
  await automationDB.exec`
    UPDATE automation_run
    SET status = ${state.status},
        finished_at = ${state.finishedAt ? new Date(state.finishedAt) : null},
        last_state = ${state as Record<string, unknown>}
    WHERE workflow_id = ${workflowId}
  `;
}

export async function appendAudit(
  input: Omit<AutomationAuditEvent, "sequence">,
): Promise<AutomationAuditEvent> {
  const row = await automationDB.queryRow<{
    sequence: number;
    event_id: string;
    workflow_id: string;
    run_id: string;
    plan_id: string;
    event_type: AutomationAuditEvent["eventType"];
    occurred_at: Date;
    actor: string;
    details: Record<string, unknown>;
  }>`
    INSERT INTO automation_audit_event
      (event_id, workflow_id, run_id, plan_id, event_type, occurred_at, actor, details)
    VALUES (
      ${input.eventId}, ${input.workflowId}, ${input.runId}, ${input.planId},
      ${input.eventType}, ${new Date(input.occurredAt)}, ${input.actor}, ${input.details}
    )
    RETURNING sequence::int, event_id, workflow_id, run_id, plan_id, event_type,
              occurred_at, actor, details
  `;
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
}

export async function listAudit(workflowId: string): Promise<AutomationAuditEvent[]> {
  const events: AutomationAuditEvent[] = [];
  for await (const row of automationDB.query<{
    sequence: number;
    event_id: string;
    workflow_id: string;
    run_id: string;
    plan_id: string;
    event_type: AutomationAuditEvent["eventType"];
    occurred_at: Date;
    actor: string;
    details: Record<string, unknown>;
  }>`
    SELECT sequence::int, event_id, workflow_id, run_id, plan_id, event_type,
           occurred_at, actor, details
    FROM automation_audit_event WHERE workflow_id = ${workflowId} ORDER BY sequence
  `) {
    events.push(
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
  }
  return events;
}
