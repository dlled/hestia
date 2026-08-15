import { api } from "encore.dev/api";
import { automation } from "~encore/clients";
import type { AutomationDefinitionView, AutomationSimulationView } from "../shared/contracts";

export const saveAutomationDraft = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/automations/drafts" },
  async (input: AutomationDefinitionView): Promise<AutomationDefinitionView> =>
    automation.saveAutomationDraft(input),
);

export const publishAutomation = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/automations/:automationId/versions/:version/publish",
  },
  async (request: { automationId: string; version: number }): Promise<AutomationDefinitionView> =>
    automation.publishAutomation(request),
);

export const getAutomationDefinition = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/v1/automations/:automationId/versions/:version",
  },
  async (request: { automationId: string; version: number }): Promise<AutomationDefinitionView> =>
    automation.getAutomationDefinition(request),
);

export const simulateAutomation = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/automations/:automationId/versions/:version/simulate",
  },
  async (request: {
    automationId: string;
    version: number;
    snapshotJson: string;
    replayedAt: string;
  }): Promise<AutomationSimulationView> => automation.simulateAutomation(request),
);
