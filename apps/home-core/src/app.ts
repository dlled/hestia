import {
  EntityListResponseSchema,
  HomeIdSchema,
  HomeTopologySchema,
  type ReadinessCheck,
} from "@hestia/contracts";
import { createServiceApp, HttpError } from "@hestia/service-runtime";
import type { Express } from "express";
import type { TwinRepository } from "./repository.js";
import { createSleepContext } from "./sleep-context.js";

export function createHomeCoreApp(options: {
  repository: TwinRepository;
  eventLaneConnected?: () => boolean;
}): Express {
  return createServiceApp({
    service: "home-core",
    readiness: async (): Promise<ReadinessCheck[]> => [
      {
        name: "entity-event-lane",
        status: options.eventLaneConnected?.() === false ? "down" : "ok",
      },
    ],
    register(app) {
      app.get("/api/v1/homes/:homeId/entities", async (request, response) => {
        const parsed = HomeIdSchema.safeParse(request.params.homeId);
        if (!parsed.success) throw new HttpError(400, "Invalid homeId");
        response.json(
          EntityListResponseSchema.parse({
            homeId: parsed.data,
            entities: await options.repository.list(parsed.data),
          }),
        );
      });
      app.get("/api/v1/homes/:homeId/topology", async (request, response) => {
        const parsed = HomeIdSchema.safeParse(request.params.homeId);
        if (!parsed.success) throw new HttpError(400, "Invalid homeId");
        response.json(HomeTopologySchema.parse(await options.repository.topology(parsed.data)));
      });
      app.get("/api/v1/homes/:homeId/contexts/sleep", async (request, response) => {
        const parsed = HomeIdSchema.safeParse(request.params.homeId);
        if (!parsed.success) throw new HttpError(400, "Invalid homeId");
        response.json(createSleepContext(parsed.data, await options.repository.list(parsed.data)));
      });
    },
  });
}
