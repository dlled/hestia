import { type SleepContext, SleepContextSchema, type TwinEntity } from "@hestia/contracts";

const CategoryByDomain = {
  light: "lights",
  climate: "climate",
  cover: "covers",
  media_player: "media",
  alarm_control_panel: "alarm",
} as const;

export function createSleepContext(
  homeId: string,
  entities: TwinEntity[],
  now = new Date(),
): SleepContext {
  const categories: Record<(typeof CategoryByDomain)[keyof typeof CategoryByDomain], unknown[]> = {
    lights: [],
    climate: [],
    covers: [],
    media: [],
    alarm: [],
  };
  let stale = 0;
  let unavailable = 0;
  for (const entity of entities) {
    const category = CategoryByDomain[entity.domain as keyof typeof CategoryByDomain];
    if (!category) continue;
    const attention =
      entity.observedState.quality === "stale"
        ? "stale"
        : entity.observedState.quality === "unavailable"
          ? "unavailable"
          : "ready";
    if (attention === "stale") stale += 1;
    if (attention === "unavailable") unavailable += 1;
    categories[category].push({
      entityId: entity.id,
      name: entity.name,
      ...(entity.areaId ? { areaId: entity.areaId } : {}),
      domain: entity.domain,
      observedState: entity.observedState,
      attention,
    });
  }
  const relevant = Object.values(categories).reduce((total, items) => total + items.length, 0);
  return SleepContextSchema.parse({
    homeId,
    generatedAt: now.toISOString(),
    readiness: stale + unavailable > 0 ? "degraded" : "ready",
    summary: { relevant, stale, unavailable },
    categories,
  });
}
