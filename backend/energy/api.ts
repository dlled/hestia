import { APIError, api } from "encore.dev/api";
import type {
  EnergyReadingView,
  EnergyRecommendationView,
  EnergyTariffView,
} from "../shared/contracts";
import { energyDB } from "./db";
import { buildEnergyRecommendation } from "./recommendation";

interface EnergyReadingInput {
  homeId: string;
  meterId: string;
  observedAt: string;
  powerW: number;
  energyKWh: number;
}

interface EnergyTariffInput {
  homeId: string;
  startsAt: string;
  endsAt: string;
  pricePerKWh: number;
  currency: string;
}

export const ingestReading = api(
  { method: "POST", path: "/internal/energy/readings" },
  async (input: EnergyReadingInput): Promise<EnergyReadingView> => {
    const observedAt = new Date(input.observedAt);
    if (
      !input.homeId ||
      !input.meterId ||
      Number.isNaN(observedAt.getTime()) ||
      input.powerW < 0 ||
      input.energyKWh < 0
    ) {
      throw APIError.invalidArgument("Invalid energy reading");
    }
    const reading = { ...input, readingId: id("reading") };
    await energyDB.exec`
      INSERT INTO energy_reading (reading_id, home_id, meter_id, observed_at, power_w, energy_kwh)
      VALUES (
        ${reading.readingId}, ${reading.homeId}, ${reading.meterId}, ${observedAt},
        ${reading.powerW}, ${reading.energyKWh}
      )
    `;
    return reading;
  },
);

export const putTariff = api(
  { method: "POST", path: "/internal/energy/tariffs" },
  async (input: EnergyTariffInput): Promise<EnergyTariffView> => {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!input.homeId || startsAt >= endsAt || input.pricePerKWh < 0 || !input.currency) {
      throw APIError.invalidArgument("Invalid energy tariff");
    }
    const tariff = { ...input, tariffId: id("tariff") };
    await energyDB.exec`
      INSERT INTO energy_tariff
        (tariff_id, home_id, starts_at, ends_at, price_per_kwh, currency)
      VALUES (
        ${tariff.tariffId}, ${tariff.homeId}, ${startsAt}, ${endsAt},
        ${tariff.pricePerKWh}, ${tariff.currency}
      )
    `;
    return tariff;
  },
);

export const recommend = api(
  { method: "POST", path: "/internal/energy/homes/:homeId/recommendations" },
  async ({
    homeId,
    flexibleEnergyKWh,
    at,
  }: {
    homeId: string;
    flexibleEnergyKWh: number;
    at: string;
  }): Promise<EnergyRecommendationView> => {
    const now = new Date(at);
    if (Number.isNaN(now.getTime()) || flexibleEnergyKWh <= 0) {
      throw APIError.invalidArgument("Recommendation time and flexible energy must be valid");
    }
    const tariffs: EnergyTariffView[] = [];
    for await (const row of energyDB.query<{
      tariff_id: string;
      home_id: string;
      starts_at: Date;
      ends_at: Date;
      price_per_kwh: number;
      currency: string;
    }>`
      SELECT tariff_id, home_id, starts_at, ends_at, price_per_kwh, currency
      FROM energy_tariff WHERE home_id = ${homeId} AND ends_at > ${now}
      ORDER BY starts_at
    `)
      tariffs.push({
        tariffId: row.tariff_id,
        homeId: row.home_id,
        startsAt: row.starts_at.toISOString(),
        endsAt: row.ends_at.toISOString(),
        pricePerKWh: row.price_per_kwh,
        currency: row.currency,
      });
    const current = tariffs.find((tariff) => Date.parse(tariff.startsAt) <= now.getTime());
    const cheapest = [...tariffs].sort((left, right) => left.pricePerKWh - right.pricePerKWh)[0];
    if (!current || !cheapest) throw APIError.failedPrecondition("Tariff coverage is incomplete");
    const recommendation = buildEnergyRecommendation({
      homeId,
      currentTariff: current,
      cheapestTariff: cheapest,
      flexibleEnergyKWh,
      generatedAt: now,
      recommendationId: id("rec"),
    });
    await energyDB.exec`
      INSERT INTO energy_recommendation (recommendation_id, home_id, payload, generated_at)
      VALUES (
        ${recommendation.recommendationId}, ${homeId},
        ${recommendation as unknown as Record<string, unknown>}, ${now}
      )
    `;
    return recommendation;
  },
);

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
