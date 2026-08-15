import { describe, expect, it } from "vitest";
import { buildEnergyRecommendation } from "./recommendation";

describe("energy recommendation", () => {
  it("quantifies a cheaper window without producing an effect", () => {
    const recommendation = buildEnergyRecommendation({
      homeId: "home_primary",
      currentTariff: {
        tariffId: "tariff_peak",
        homeId: "home_primary",
        startsAt: "2026-08-15T18:00:00.000Z",
        endsAt: "2026-08-15T22:00:00.000Z",
        pricePerKWh: 0.32,
        currency: "EUR",
      },
      cheapestTariff: {
        tariffId: "tariff_offpeak",
        homeId: "home_primary",
        startsAt: "2026-08-16T01:00:00.000Z",
        endsAt: "2026-08-16T06:00:00.000Z",
        pricePerKWh: 0.12,
        currency: "EUR",
      },
      flexibleEnergyKWh: 10,
      generatedAt: new Date("2026-08-15T19:00:00.000Z"),
      recommendationId: "rec_0123456789",
    });

    expect(recommendation).toMatchObject({
      estimatedSavings: 2,
      currency: "EUR",
      suggestedStartAt: "2026-08-16T01:00:00.000Z",
      effectful: false,
    });
  });
});
