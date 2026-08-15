import { APIError, api, type Header } from "encore.dev/api";
import { ai, automation } from "~encore/clients";
import type {
  IntentInterpretationView,
  ResidentIntentRequestView,
  SleepPlanPreviewRequestView,
  SleepPlanPreviewView,
} from "../shared/contracts";
import { validWorkerAuthorization } from "./auth";
import { WorkerServiceToken } from "./secrets";

type Authorized<T> = T & { authorization?: Header<"Authorization"> };

export const interpretIntent = api(
  { expose: true, method: "POST", path: "/workers/v1/intents/interpret", sensitive: true },
  async (request: Authorized<ResidentIntentRequestView>): Promise<IntentInterpretationView> => {
    authorize(request.authorization);
    return ai.interpretIntent(request);
  },
);

export const previewSleep = api(
  { expose: true, method: "POST", path: "/workers/v1/plans/sleep/preview", sensitive: true },
  async (request: Authorized<SleepPlanPreviewRequestView>): Promise<SleepPlanPreviewView> => {
    authorize(request.authorization);
    return automation.previewSleep(request);
  },
);

function authorize(authorization: string | undefined): void {
  if (!validWorkerAuthorization(authorization, WorkerServiceToken())) {
    throw APIError.unauthenticated("Invalid worker service credential");
  }
}
