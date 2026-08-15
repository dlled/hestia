import { timingSafeEqual } from "node:crypto";
import type { ModelGateway } from "@hestia/model-client";
import { createServiceApp, HttpError } from "@hestia/service-runtime";
import type { Express, Request } from "express";
import { z } from "zod";

const StructuredCompletionSchema = z.strictObject({
  profile: z.string().min(1),
  schemaName: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u),
  jsonSchema: z.record(z.string(), z.unknown()),
  system: z.string().min(1).max(16_000),
  input: z.unknown(),
});

export function createModelGatewayApp(options: {
  model?: ModelGateway;
  authToken?: string;
}): Express {
  return createServiceApp({
    service: "model-gateway",
    readiness: async () => [
      {
        name: "openrouter",
        status: options.model ? "ok" : "degraded",
        detail: options.model ? "provider profile configured" : "provider not configured",
      },
    ],
    register(app) {
      app.post("/internal/v1/structured-completions", async (request, response) => {
        authorize(request, options.authToken);
        if (!options.model) throw new HttpError(503, "Model provider is not configured");
        const parsed = StructuredCompletionSchema.safeParse(request.body);
        if (!parsed.success) throw new HttpError(400, "Invalid structured completion request");
        response.json({ output: await options.model.completeStructured(parsed.data) });
      });
    },
  });
}

function authorize(request: Request, token: string | undefined): void {
  if (!token) return;
  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "Unauthorized");
  }
  const supplied = Buffer.from(authorization.slice(7));
  const configured = Buffer.from(token);
  if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
    throw new HttpError(401, "Unauthorized");
  }
}
