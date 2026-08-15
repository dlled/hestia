import {
  type AgentClarification,
  AgentClarificationSchema,
  type AgentIntentState,
  type IntentInterpretation,
  type ResidentIntentRequest,
  ResidentIntentRequestSchema,
  type SleepPlanPreview,
  TaskQueues,
} from "@hestia/contracts";
import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";

interface AgentActivities {
  interpretResidentIntent(input: ResidentIntentRequest): Promise<IntentInterpretation>;
  previewInterpretedSleepIntent(input: {
    interpretation: IntentInterpretation;
    requestedBy: string;
  }): Promise<SleepPlanPreview>;
}

const activities = proxyActivities<AgentActivities>({
  taskQueue: TaskQueues.ai,
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

export const agentIntentStateQuery = defineQuery<AgentIntentState>("agentIntentState");
export const agentClarificationSignal =
  defineSignal<[clarification: AgentClarification]>("agentClarification");

export async function agentIntentWorkflow(input: ResidentIntentRequest): Promise<AgentIntentState> {
  let request = ResidentIntentRequestSchema.parse(input);
  let clarification: AgentClarification | undefined;
  const state: AgentIntentState = { status: "interpreting", request, attempt: 1 };

  setHandler(agentIntentStateQuery, () => state);
  setHandler(agentClarificationSignal, (value) => {
    clarification = AgentClarificationSchema.parse(value);
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    state.attempt = attempt;
    state.status = "interpreting";
    state.request = request;
    const interpretation = await activities.interpretResidentIntent(request);
    state.interpretation = interpretation;
    if (interpretation.kind === "sleep" && interpretation.confidence >= 0.65) {
      state.status = "planning";
      state.preview = await activities.previewInterpretedSleepIntent({
        interpretation,
        requestedBy: request.requestedBy,
      });
      state.status = "completed";
      return state;
    }

    state.status = "awaiting_clarification";
    await condition(() => clarification !== undefined);
    if (!clarification) throw new Error("Clarification signal was not retained");
    const clarifiedUtterance = `${request.utterance}\nClarification from ${clarification.providedBy}: ${clarification.text}`;
    request = {
      ...request,
      utterance: clarifiedUtterance.slice(-1_000),
    };
    clarification = undefined;
  }

  state.status = "failed";
  state.error = "Intent remained ambiguous after three attempts";
  return state;
}
