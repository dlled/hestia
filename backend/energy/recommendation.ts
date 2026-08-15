import type { EnergyRecommendationView, EnergyTariffView } from "../shared/contracts";

export function buildEnergyRecommendation(input: {
  homeId: string;
  currentTariff: EnergyTariffView;
  cheapestTariff: EnergyTariffView;
  flexibleEnergyKWh: number;
  generatedAt: Date;
  recommendationId: string;
}): EnergyRecommendationView {
  const estimatedSavings = Math.max(
    0,
    input.flexibleEnergyKWh * (input.currentTariff.pricePerKWh - input.cheapestTariff.pricePerKWh),
  );
  return {
    recommendationId: input.recommendationId,
    homeId: input.homeId,
    generatedAt: input.generatedAt.toISOString(),
    title: "Move flexible consumption to the cheapest tariff window",
    rationale: `Current ${input.currentTariff.pricePerKWh.toFixed(4)} vs cheapest ${input.cheapestTariff.pricePerKWh.toFixed(4)} per kWh`,
    suggestedStartAt: input.cheapestTariff.startsAt,
    estimatedSavings: Number(estimatedSavings.toFixed(4)),
    currency: input.currentTariff.currency,
    effectful: false,
  };
}
