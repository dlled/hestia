import type { EntityStateChangedEvent, HomeIngestionEvent } from "@hestia/contracts";
import type { TwinRepository } from "./repository.js";

export function createEntityStateMaterializer(repository: TwinRepository) {
  return async (event: EntityStateChangedEvent): Promise<void> => {
    await repository.upsert(event.data.entity);
  };
}

export function createHomeEventMaterializer(repository: TwinRepository) {
  return async (event: HomeIngestionEvent): Promise<void> => {
    if (event.eventType === "home.entity.state.changed") {
      await repository.upsert(event.data.entity);
      return;
    }
    await repository.replaceTopology(event.data);
  };
}
