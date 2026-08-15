import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ingestReading, putTariff, recommend } from "./api";

describe("energy Encore persistence", () => {
  it("stores telemetry and produces a non-effectful tariff recommendation", async () => {
    const homeId = `home_${randomUUID().replaceAll("-", "")}`;
    await ingestReading({
      homeId,
      meterId: "meter_grid",
      observedAt: "2026-08-15T19:00:00.000Z",
      powerW: 4200,
      energyKWh: 1234.5,
    });
    await putTariff({
      homeId,
      startsAt: "2026-08-15T18:00:00.000Z",
      endsAt: "2026-08-15T22:00:00.000Z",
      pricePerKWh: 0.32,
      currency: "EUR",
    });
    await putTariff({
      homeId,
      startsAt: "2026-08-16T01:00:00.000Z",
      endsAt: "2026-08-16T06:00:00.000Z",
      pricePerKWh: 0.12,
      currency: "EUR",
    });

    await expect(
      recommend({
        homeId,
        flexibleEnergyKWh: 10,
        at: "2026-08-15T19:00:00.000Z",
      }),
    ).resolves.toMatchObject({ estimatedSavings: 2, effectful: false });
  });
});
