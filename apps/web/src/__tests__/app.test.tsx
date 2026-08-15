import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app";

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    let approved = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/v1/intents/runs") && init?.method === "POST") {
          return json(
            { workflowId: "hestia-wf-agent-ui0123456789", runId: "run-agent-ui0123456789" },
            202,
          );
        }
        if (url.includes("/api/v1/intents/runs/")) {
          return json({
            status: "completed",
            request: { utterance: "I'm going to sleep", requestedBy: "resident" },
            attempt: 1,
            interpretation: {
              kind: "sleep",
              confidence: 0.97,
              summary: "Prepare the home for sleep",
              sleep: { climateTargetC: 19, closeCovers: true, armAlarm: true },
            },
            preview: { plan: sleepPlan(), skipped: [] },
          });
        }
        if (url.includes("/api/v1/intents/preview")) {
          return json({
            interpretation: {
              kind: "sleep",
              confidence: 0.97,
              summary: "Prepare the home for sleep",
              sleep: { climateTargetC: 19, closeCovers: true, armAlarm: true },
            },
            preview: { plan: sleepPlan(), skipped: [] },
            modelProfile: "intent-fast",
          });
        }
        if (url.includes("/api/v1/automations/plans/sleep/preview")) {
          return json({ plan: sleepPlan(), skipped: [] });
        }
        if (url.endsWith("/api/v1/automations/runs") && init?.method === "POST") {
          return json({ workflowId: "hestia-wf-ui0123456789" }, 202);
        }
        if (url.includes("/approval") && init?.method === "POST") {
          approved = true;
          return json({ accepted: true }, 202);
        }
        if (url.includes("/api/v1/automations/runs/") && url.endsWith("/audit")) {
          return json({
            workflowId: "hestia-wf-ui0123456789",
            events: [
              {
                sequence: 1,
                eventType: "run.started",
                occurredAt: "2026-08-14T22:00:00.000Z",
                actor: "resident",
                details: {},
              },
            ],
          });
        }
        if (url.includes("/api/v1/automations/runs/")) {
          return json({
            workflowId: "hestia-wf-ui0123456789",
            runId: "run-ui0123456789",
            planId: "plan_ui0123456789",
            version: 1,
            startedAt: "2026-08-14T22:00:00.000Z",
            state: {
              planId: "plan_ui0123456789",
              status: approved ? "completed" : "awaiting_approval",
              currentAction: 0,
              ...(approved ? {} : { pendingApprovalId: "appr_ui0123456789" }),
              actions: [
                {
                  actionId: "action_ui0123456789",
                  commandId: "cmd_ui0123456789",
                  status: approved ? "confirmed" : "approved",
                },
              ],
            },
          });
        }
        if (url.includes("/api/v1/meta")) {
          return json({
            name: "HESTIA",
            version: "0.1.0",
            phase: "0-foundation",
            thesis: "Probabilistic intelligence above; deterministic execution below.",
            lanes: ["http", "nats", "temporal"],
          });
        }
        if (url.includes("/health")) {
          return json({
            status: "ok",
            service: "edge-api",
            version: "0.1.0",
            timestamp: "2026-08-14T00:00:00.000Z",
          });
        }
        if (url.includes("/api/v1/capabilities")) {
          return json({
            capabilities: [
              { id: "level.set", title: "Set level", baseRisk: "R1", privacySensitive: false },
            ],
          });
        }
        if (url.includes("/api/v1/home/entities")) {
          return json({
            homeId: "home_primary",
            entities: [
              {
                id: "ent_0123456789abcdef",
                homeId: "home_primary",
                areaId: "area_0123456789abcdef",
                name: "Bedroom lamp",
                domain: "light",
                capabilities: ["power.onOff"],
                externalRef: {
                  system: "home_assistant",
                  instanceId: "ha_main",
                  entityId: "light.bedroom",
                },
                observedState: {
                  value: "on",
                  timestamp: "2026-08-14T20:00:00.000Z",
                  source: "home_assistant:ha_main",
                  quality: "good",
                },
              },
            ],
          });
        }
        if (url.includes("/api/v1/home/topology")) {
          return json({
            homeId: "home_primary",
            areas: [{ id: "area_0123456789abcdef", name: "Bedroom", kind: "room" }],
            devices: [],
          });
        }
        if (url.includes("/api/v1/home/integration-status")) {
          return json({
            status: "ok",
            rest: true,
            streaming: true,
            topology: true,
            discoveredEntities: 1,
            discoveredAreas: 1,
            discoveredDevices: 1,
          });
        }
        if (url.includes("/api/v1/home/contexts/sleep")) {
          return json({
            homeId: "home_primary",
            generatedAt: "2026-08-14T20:00:00.000Z",
            readiness: "ready",
            summary: { relevant: 1, stale: 0, unavailable: 0 },
            categories: {
              lights: [
                {
                  entityId: "ent_0123456789abcdef",
                  name: "Bedroom lamp",
                  domain: "light",
                  observedState: {
                    value: "on",
                    timestamp: "2026-08-14T20:00:00.000Z",
                    source: "home_assistant:ha_main",
                    quality: "good",
                  },
                  attention: "ready",
                },
              ],
              climate: [],
              covers: [],
              media: [],
              alarm: [],
            },
          });
        }
        return json({}, 404);
      }),
    );
  });

  it("renders the hearth dashboard", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "HESTIA" })).toBeInTheDocument();
    expect(await screen.findByText("edge-api ok")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run durable ping" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Bedroom lamp" })).toBeInTheDocument();
    expect(screen.getByText("Bedroom · light.bedroom")).toBeInTheDocument();
    expect(screen.getByText("1 entities")).toBeInTheDocument();
    expect(screen.getByText(/Sleep context: ready/u)).toBeInTheDocument();
  });

  it("previews, executes, and explicitly approves a sleep plan", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Bedroom lamp" });

    fireEvent.click(screen.getByRole("button", { name: "Preview sleep plan" }));
    expect(await screen.findByText(/security\.arm/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Execute visible plan" }));
    expect(await screen.findByRole("button", { name: "Approve action" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve action" }));

    expect(await screen.findByText("Run: completed")).toBeInTheDocument();
    expect(screen.getByText(/Audit trail/u)).toBeInTheDocument();
  });

  it("turns natural language into a visible plan without executing it", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Bedroom lamp" });
    fireEvent.change(screen.getByLabelText("Tell HESTIA what you want"), {
      target: { value: "Set the home for sleep and arm the alarm" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Interpret and preview" }));

    expect(await screen.findByText(/Prepare the home for sleep/u)).toBeInTheDocument();
    expect(screen.getByText(/security\.arm/u)).toBeInTheDocument();
    expect(screen.queryByText(/Run: /u)).not.toBeInTheDocument();
  });
});

function sleepPlan() {
  return {
    planId: "plan_ui0123456789",
    version: 1,
    homeId: "home_primary",
    title: "Go to sleep",
    requestedBy: "resident",
    createdAt: "2026-08-14T22:00:00.000Z",
    dryRun: false,
    actions: [
      {
        actionId: "action_ui0123456789",
        command: {
          commandId: "cmd_ui0123456789",
          idempotencyKey: "ui-security-arm-idem",
          capability: "security.arm",
          target: { homeId: "home_primary", entityId: "ent_0123456789abcdef" },
          input: {},
          risk: "R3",
          dryRun: false,
        },
        expectedObservation: {
          entityId: "ent_0123456789abcdef",
          attribute: "state",
          equals: "armed_away",
          timeoutMs: 30_000,
        },
      },
    ],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
