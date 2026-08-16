import { useEffect, useState } from "react";
import {
  type AgentIntentState,
  type AutomationAudit,
  type AutomationRun,
  type Capability,
  type EntityList,
  getJson,
  type Health,
  type HomeAssistantSyncResult,
  type HomeTopology,
  type Incident,
  type IncidentAudit,
  type IntegrationCheckpoint,
  type IntentPlanPreview,
  type Meta,
  type PingStatus,
  postJson,
  type SleepContext,
  type SleepPlanPreview,
} from "./lib/api";

export function App(): React.JSX.Element {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [ping, setPing] = useState<PingStatus | null>(null);
  const [home, setHome] = useState<EntityList | null>(null);
  const [topology, setTopology] = useState<HomeTopology | null>(null);
  const [integration, setIntegration] = useState<IntegrationCheckpoint | null>(null);
  const [sleepContext, setSleepContext] = useState<SleepContext | null>(null);
  const [sleepPreview, setSleepPreview] = useState<SleepPlanPreview | null>(null);
  const [intentText, setIntentText] = useState("I'm going to sleep");
  const [intentResult, setIntentResult] = useState<IntentPlanPreview | null>(null);
  const [agentWorkflowId, setAgentWorkflowId] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<AgentIntentState | null>(null);
  const [clarification, setClarification] = useState("");
  const [automationRun, setAutomationRun] = useState<AutomationRun | null>(null);
  const [automationAudit, setAutomationAudit] = useState<AutomationAudit | null>(null);
  const [climateTargetC, setClimateTargetC] = useState(18);
  const [armAlarm, setArmAlarm] = useState(false);
  const [sync, setSync] = useState<HomeAssistantSyncResult | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentAudits, setIncidentAudits] = useState<Record<string, IncidentAudit>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      getJson<Meta>("/api/v1/meta"),
      getJson<Health>("/health"),
      getJson<{ capabilities: Capability[] }>("/api/v1/capabilities"),
      getJson<EntityList>("/api/v1/home/entities"),
      getJson<HomeTopology>("/api/v1/home/topology"),
      getJson<IntegrationCheckpoint>("/api/v1/home/integration-status"),
      getJson<SleepContext>("/api/v1/home/contexts/sleep"),
      getJson<{ incidents: Incident[] }>("/api/v1/homes/home_primary/incidents"),
    ])
      .then(
        ([
          nextMeta,
          nextHealth,
          nextCapabilities,
          nextHome,
          nextTopology,
          nextIntegration,
          nextSleepContext,
          nextIncidents,
        ]) => {
          setMeta(nextMeta);
          setHealth(nextHealth);
          setCapabilities(nextCapabilities.capabilities);
          setHome(nextHome);
          setTopology(nextTopology);
          setIntegration(nextIntegration);
          setSleepContext(nextSleepContext);
          setIncidents(nextIncidents.incidents);
        },
      )
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "edge-api is unreachable");
      });
  }, []);

  async function refreshIncidents(): Promise<void> {
    const result = await getJson<{ incidents: Incident[] }>("/api/v1/homes/home_primary/incidents");
    setIncidents(result.incidents);
  }

  async function showIncidentTimeline(incidentId: string): Promise<void> {
    setError(null);
    try {
      const audit = await getJson<IncidentAudit>(`/api/v1/incidents/${incidentId}/audit`);
      setIncidentAudits((current) => ({ ...current, [incidentId]: audit }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "incident timeline failed");
    }
  }

  async function acknowledgeIncident(incidentId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/v1/incidents/${incidentId}/acknowledge`, {});
      await Promise.all([refreshIncidents(), showIncidentTimeline(incidentId)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "incident acknowledgement failed");
    } finally {
      setBusy(false);
    }
  }

  async function resolveIncident(incidentId: string, status: "resolved" | "false_positive") {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/v1/incidents/${incidentId}/resolve`, {
        status,
        note: status === "resolved" ? "Resolved from Incident Center" : "Marked false positive",
      });
      await Promise.all([refreshIncidents(), showIncidentTimeline(incidentId)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "incident resolution failed");
    } finally {
      setBusy(false);
    }
  }

  async function syncHome(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<HomeAssistantSyncResult>("/api/v1/home/sync", {});
      setSync(result);
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const refreshed = await getJson<EntityList>("/api/v1/home/entities");
        const refreshedTopology = await getJson<HomeTopology>("/api/v1/home/topology");
        const refreshedIntegration = await getJson<IntegrationCheckpoint>(
          "/api/v1/home/integration-status",
        );
        const refreshedSleepContext = await getJson<SleepContext>("/api/v1/home/contexts/sleep");
        setHome(refreshed);
        setTopology(refreshedTopology);
        setIntegration(refreshedIntegration);
        setSleepContext(refreshedSleepContext);
        if (refreshed.entities.length >= result.published) break;
        await wait(150);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Home Assistant sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function runPing(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const started = await postJson<PingStatus>("/api/v1/system/ping", { requestedBy: "hearth" });
      setPing(started);
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const current = await getJson<PingStatus>(`/api/v1/system/ping/${started.workflowId}`);
        setPing(current);
        if (current.status !== "running") {
          break;
        }
        await wait(400);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "ping failed");
    } finally {
      setBusy(false);
    }
  }

  async function previewSleepPlan(): Promise<void> {
    setBusy(true);
    setError(null);
    setAutomationRun(null);
    setAutomationAudit(null);
    try {
      setSleepPreview(
        await postJson<SleepPlanPreview>("/api/v1/automations/plans/sleep/preview", {
          requestedBy: "resident",
          climateTargetC,
          closeCovers: true,
          armAlarm,
          dryRun: false,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "sleep-plan preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function previewIntent(): Promise<void> {
    setBusy(true);
    setError(null);
    setAutomationRun(null);
    setAutomationAudit(null);
    try {
      const started = await postJson<{ workflowId: string; runId: string }>(
        "/api/v1/intents/runs",
        {
          utterance: intentText,
          requestedBy: "resident",
        },
      );
      setAgentWorkflowId(started.workflowId);
      await pollAgentIntent(started.workflowId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "intent preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitClarification(): Promise<void> {
    if (!agentWorkflowId || clarification.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/v1/intents/runs/${agentWorkflowId}/clarification`, {
        text: clarification,
        providedBy: "resident",
      });
      setClarification("");
      await pollAgentIntent(agentWorkflowId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "clarification failed");
    } finally {
      setBusy(false);
    }
  }

  async function pollAgentIntent(workflowId: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const state = await getJson<AgentIntentState>(`/api/v1/intents/runs/${workflowId}`);
      setAgentState(state);
      if (state.status === "awaiting_clarification" || state.status === "failed") return;
      if (state.status === "completed" && state.interpretation) {
        const result: IntentPlanPreview = {
          interpretation: state.interpretation,
          ...(state.preview ? { preview: state.preview } : {}),
          modelProfile: "intent-fast",
        };
        setIntentResult(result);
        setSleepPreview(result.preview ?? null);
        if (result.interpretation.sleep) {
          setClimateTargetC(result.interpretation.sleep.climateTargetC);
          setArmAlarm(result.interpretation.sleep.armAlarm);
        }
        return;
      }
      await wait(300);
    }
    throw new Error("agent intent status timed out");
  }

  async function executeSleepPlan(): Promise<void> {
    if (!sleepPreview) return;
    setBusy(true);
    setError(null);
    try {
      const started = await postJson<{ workflowId: string }>(
        "/api/v1/automations/runs",
        sleepPreview.plan,
      );
      await pollAutomation(started.workflowId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "sleep-plan execution failed");
    } finally {
      setBusy(false);
    }
  }

  async function decideApproval(approved: boolean): Promise<void> {
    const approvalId = automationRun?.state.pendingApprovalId;
    if (!automationRun || !approvalId) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/v1/automations/runs/${automationRun.workflowId}/approval`, {
        approvalId,
        approved,
        decidedBy: "resident",
        decidedAt: new Date().toISOString(),
      });
      await pollAutomation(automationRun.workflowId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancelAutomation(): Promise<void> {
    if (!automationRun) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/v1/automations/runs/${automationRun.workflowId}/cancel`, {});
      await pollAutomation(automationRun.workflowId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "cancellation failed");
    } finally {
      setBusy(false);
    }
  }

  async function pollAutomation(workflowId: string): Promise<void> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const current = await getJson<AutomationRun>(`/api/v1/automations/runs/${workflowId}`);
      setAutomationRun(current);
      if (current.state.status === "awaiting_approval" || terminal(current.state.status)) {
        setAutomationAudit(
          await getJson<AutomationAudit>(`/api/v1/automations/runs/${workflowId}/audit`),
        );
        if (terminal(current.state.status)) await refreshObservedHome();
        return;
      }
      await wait(400);
    }
    throw new Error("automation status timed out");
  }

  async function refreshObservedHome(): Promise<void> {
    const [nextHome, nextContext] = await Promise.all([
      getJson<EntityList>("/api/v1/home/entities"),
      getJson<SleepContext>("/api/v1/home/contexts/sleep"),
    ]);
    setHome(nextHome);
    setSleepContext(nextContext);
  }

  const sleepEntityNames = new Map(
    sleepContext
      ? Object.values(sleepContext.categories)
          .flat()
          .map((item) => [item.entityId, item.name] as const)
      : [],
  );

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <span className="flame" aria-hidden="true" />
          <div>
            <p className="eyebrow">local-first home OS</p>
            <h1>HESTIA</h1>
          </div>
        </div>
        <p className="thesis">
          {meta?.thesis ?? "Probabilistic intelligence above; deterministic execution below."}
        </p>
      </header>

      <main className="layout">
        <section className="rooms" aria-label="Observed home">
          {(home?.entities ?? []).map((entity) => (
            <article className="room" key={entity.id}>
              <div className="entity-head">
                <h2>{entity.name}</h2>
                <span className={`quality ${entity.observedState.quality}`}>
                  {entity.observedState.quality}
                </span>
              </div>
              <p>
                {String(entity.observedState.value)}
                {entity.observedState.unit ? ` ${entity.observedState.unit}` : ""} · {entity.domain}
              </p>
              <small>
                {topology?.areas.find((area) => area.id === entity.areaId)?.name ?? "Unassigned"} ·{" "}
                {entity.externalRef.entityId}
              </small>
            </article>
          ))}
          {home?.entities.length === 0 ? (
            <article className="room empty">
              <h2>No observed entities</h2>
              <p>Connect Home Assistant and run discovery.</p>
              <button type="button" onClick={() => void syncHome()} disabled={busy}>
                {busy ? "Discovering…" : "Discover Home Assistant"}
              </button>
              {sync ? <small>{sync.published} observations published</small> : null}
            </article>
          ) : null}
        </section>

        <section className="hearth" aria-labelledby="hearth-title">
          <div className="section-head">
            <div>
              <p className="eyebrow">Phase 1 · Connected home</p>
              <h2 id="hearth-title">Hearth check</h2>
            </div>
            <span className={health?.status === "ok" ? "pill ok" : "pill warn"}>
              {health ? `${health.service} ${health.status}` : "edge-api unknown"}
            </span>
          </div>
          <p>
            Durable execution first. This ping sleeps inside Temporal. Kill the worker mid-wait and
            it finishes when the worker returns.
          </p>
          <div className="actions">
            <button type="button" onClick={() => void runPing()} disabled={busy}>
              {busy ? "Waiting on Temporal…" : "Run durable ping"}
            </button>
            {ping ? (
              <span className="mono">
                {ping.status}
                {ping.result ? ` · ${ping.result.holdMs}ms hold` : ""}
              </span>
            ) : null}
          </div>
          {ping ? (
            <dl className="facts">
              <div>
                <dt>Workflow</dt>
                <dd>{ping.workflowId}</dd>
              </div>
              <div>
                <dt>Run</dt>
                <dd>{ping.runId}</dd>
              </div>
              {ping.result ? (
                <div>
                  <dt>Worker</dt>
                  <dd>{ping.result.finished.workerId}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {integration ? (
            <dl className="facts">
              <div>
                <dt>Home Assistant</dt>
                <dd>{integration.status}</dd>
              </div>
              <div>
                <dt>Observed</dt>
                <dd>{integration.discoveredEntities} entities</dd>
              </div>
              <div>
                <dt>Topology</dt>
                <dd>
                  {integration.discoveredAreas} areas · {integration.discoveredDevices} devices
                </dd>
              </div>
            </dl>
          ) : null}
          {sleepContext ? (
            <p className="mono">
              Sleep context: {sleepContext.readiness} · {sleepContext.summary.relevant} relevant ·{" "}
              {sleepContext.summary.stale + sleepContext.summary.unavailable} need attention
            </p>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
        </section>

        <section className="automation" aria-labelledby="sleep-title">
          <div className="section-head">
            <div>
              <p className="eyebrow">Phase 3 · Agentic control</p>
              <h2 id="sleep-title">Going to sleep</h2>
            </div>
            <span className={`pill ${sleepContext?.readiness === "ready" ? "ok" : "warn"}`}>
              {sleepContext?.readiness ?? "context unknown"}
            </span>
          </div>
          <p>Preview every physical effect before policy evaluates and Temporal executes it.</p>
          <form
            className="intent-form"
            onSubmit={(event) => {
              event.preventDefault();
              void previewIntent();
            }}
          >
            <label htmlFor="resident-intent">Tell HESTIA what you want</label>
            <div>
              <input
                id="resident-intent"
                value={intentText}
                maxLength={1_000}
                onChange={(event) => setIntentText(event.target.value)}
              />
              <button type="submit" disabled={busy || intentText.trim().length === 0}>
                Interpret and preview
              </button>
            </div>
          </form>
          {intentResult ? (
            <p className="intent-summary" aria-live="polite">
              {intentResult.interpretation.summary} · confidence{" "}
              {Math.round(intentResult.interpretation.confidence * 100)}%
            </p>
          ) : null}
          {agentState?.status === "awaiting_clarification" ? (
            <form
              className="clarification-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitClarification();
              }}
            >
              <label htmlFor="agent-clarification">
                {agentState.interpretation?.summary ?? "HESTIA needs clarification"}
              </label>
              <div>
                <input
                  id="agent-clarification"
                  value={clarification}
                  maxLength={1_000}
                  onChange={(event) => setClarification(event.target.value)}
                />
                <button type="submit" disabled={busy || clarification.trim().length === 0}>
                  Continue plan
                </button>
              </div>
            </form>
          ) : null}
          <fieldset className="routine-options" disabled={busy}>
            <legend>Routine options</legend>
            <label>
              Climate target
              <span>
                <input
                  type="number"
                  min="5"
                  max="35"
                  value={climateTargetC}
                  onChange={(event) => setClimateTargetC(Number(event.target.value))}
                />
                °C
              </span>
            </label>
            <label className="check-option">
              <input
                type="checkbox"
                checked={armAlarm}
                onChange={(event) => setArmAlarm(event.target.checked)}
              />
              Arm the alarm (requires approval)
            </label>
          </fieldset>
          <div className="actions">
            <button type="button" onClick={() => void previewSleepPlan()} disabled={busy}>
              Preview sleep plan
            </button>
            {sleepPreview ? (
              <button
                className="secondary"
                type="button"
                onClick={() => void executeSleepPlan()}
                disabled={busy || automationRun?.state.status === "awaiting_approval"}
              >
                Execute visible plan
              </button>
            ) : null}
          </div>
          {sleepPreview ? (
            <div className="plan-preview">
              <h3>{sleepPreview.plan.title}</h3>
              <ol>
                {sleepPreview.plan.actions.map((action) => (
                  <li key={action.actionId}>
                    <span>
                      {action.command.capability} ·{" "}
                      {sleepEntityNames.get(action.command.target.entityId ?? "") ??
                        action.command.target.entityId}
                    </span>
                    <em>{action.command.risk}</em>
                  </li>
                ))}
              </ol>
              {sleepPreview.skipped.length > 0 ? (
                <p className="warning">{sleepPreview.skipped.length} unsafe observations skipped</p>
              ) : null}
            </div>
          ) : null}
          {automationRun ? (
            <div className="run-state" aria-live="polite">
              <p className="mono">Run: {automationRun.state.status}</p>
              <ol>
                {automationRun.state.actions.map((action, index) => (
                  <li key={action.actionId}>
                    Action {index + 1}: {action.status}
                  </li>
                ))}
              </ol>
              {automationRun.state.status === "awaiting_approval" ? (
                <fieldset className="approval">
                  <legend>Approval decision</legend>
                  <p>Policy requires explicit approval for the next action.</p>
                  <button type="button" onClick={() => void decideApproval(true)} disabled={busy}>
                    Approve action
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => void decideApproval(false)}
                    disabled={busy}
                  >
                    Reject action
                  </button>
                </fieldset>
              ) : !terminal(automationRun.state.status) ? (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void cancelAutomation()}
                  disabled={busy}
                >
                  Cancel run
                </button>
              ) : null}
            </div>
          ) : null}
          {automationAudit && automationAudit.events.length > 0 ? (
            <details className="audit">
              <summary>Audit trail · {automationAudit.events.length} events</summary>
              <ol>
                {automationAudit.events.map((event) => (
                  <li key={event.sequence}>
                    {event.eventType} · {event.actor}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        <section className="incidents" aria-labelledby="incidents-title">
          <div className="section-head">
            <div>
              <p className="eyebrow">Phase 3 · Incident response</p>
              <h2 id="incidents-title">Incident Center</h2>
            </div>
            <span className={`pill ${incidents.some(activeIncident) ? "warn" : "ok"}`}>
              {incidents.filter(activeIncident).length} active
            </span>
          </div>
          {incidents.length === 0 ? (
            <p>No incidents recorded.</p>
          ) : (
            <ol className="incident-list">
              {incidents.map((incident) => (
                <li className={`incident ${incident.severity}`} key={incident.incidentId}>
                  <div className="entity-head">
                    <h3>{incident.title}</h3>
                    <span className="mono">{incident.status}</span>
                  </div>
                  <p>{incident.body}</p>
                  <small>
                    {incident.severity} · escalation {incident.escalationStep} · playbook{" "}
                    {incident.playbookVersion ?? "manual"}
                  </small>
                  <div className="actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => void showIncidentTimeline(incident.incidentId)}
                    >
                      Show timeline
                    </button>
                    {incident.requiredAck && !incident.acknowledgedAt ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void acknowledgeIncident(incident.incidentId)}
                      >
                        Acknowledge incident
                      </button>
                    ) : null}
                    {activeIncident(incident) ? (
                      <>
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => void resolveIncident(incident.incidentId, "resolved")}
                        >
                          Resolve incident
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void resolveIncident(incident.incidentId, "false_positive")
                          }
                        >
                          Mark false positive
                        </button>
                      </>
                    ) : null}
                  </div>
                  {incidentAudits[incident.incidentId] ? (
                    <ol className="incident-timeline">
                      {incidentAudits[incident.incidentId]?.events.map((event) => (
                        <li key={event.sequence}>
                          {event.eventType} · {event.actor}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="rail">
          <section>
            <h2>Lanes</h2>
            <ul>
              {(meta?.lanes ?? ["http", "nats", "temporal"]).map((lane) => (
                <li key={lane}>{lane}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2>Capabilities</h2>
            <ul className="caps">
              {capabilities.slice(0, 8).map((capability) => (
                <li key={capability.id}>
                  <span>{capability.id}</span>
                  <em>{capability.baseRisk}</em>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function terminal(status: string): boolean {
  return ["completed", "rejected", "failed", "compensated", "cancelled", "timed_out"].includes(
    status,
  );
}

function activeIncident(incident: Incident): boolean {
  return !["resolved", "false_positive"].includes(incident.status);
}
