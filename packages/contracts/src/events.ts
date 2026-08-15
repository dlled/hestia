import { z } from "zod";
import { CorrelationIdSchema, EventIdSchema, HomeIdSchema } from "./ids.js";

export const EventSourceSchema = z.object({
  type: z.string().min(1),
  instanceId: z.string().min(1),
});

export const EventSubjectSchema = z.record(z.string(), z.string());

export const EventEnvelopeSchema = z.object({
  eventId: EventIdSchema,
  eventType: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  homeId: HomeIdSchema,
  correlationId: CorrelationIdSchema,
  causationId: z.string().min(1).optional(),
  source: EventSourceSchema,
  subject: EventSubjectSchema,
  data: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export const NatsSubjects = {
  entityStateChanged: (homeId: string, entityId: string) =>
    `home.${homeId}.entity.${entityId}.state.changed`,
  topologyDiscovered: (homeId: string) => `home.${homeId}.topology.discovered`,
  commandRequested: (homeId: string) => `home.${homeId}.command.requested`,
  commandCompleted: (homeId: string) => `home.${homeId}.command.completed`,
  automationRunStarted: (automationId: string) => `automation.${automationId}.run.started`,
  automationRunCompleted: (automationId: string) => `automation.${automationId}.run.completed`,
  agentPlanProposed: (agentRunId: string) => `agent.${agentRunId}.plan.proposed`,
  policyDecisionCreated: (homeId: string) => `policy.${homeId}.decision.created`,
  incidentStatusChanged: (incidentId: string) => `incident.${incidentId}.status.changed`,
  integrationHealthChanged: (instanceId: string) => `integration.${instanceId}.health.changed`,
} as const;
