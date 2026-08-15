import { api } from "encore.dev/api";
import { energy } from "~encore/clients";
import type {
  EnergyReadingView,
  EnergyRecommendationView,
  EnergyTariffView,
} from "../shared/contracts";

export const ingestEnergyReading = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/energy/readings" },
  async (input: {
    homeId: string;
    meterId: string;
    observedAt: string;
    powerW: number;
    energyKWh: number;
  }): Promise<EnergyReadingView> => energy.ingestReading(input),
);

export const putEnergyTariff = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/energy/tariffs" },
  async (input: {
    homeId: string;
    startsAt: string;
    endsAt: string;
    pricePerKWh: number;
    currency: string;
  }): Promise<EnergyTariffView> => energy.putTariff(input),
);

export const createEnergyRecommendation = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/energy/homes/:homeId/recommendations",
  },
  async (input: {
    homeId: string;
    flexibleEnergyKWh: number;
    at: string;
  }): Promise<EnergyRecommendationView> => energy.recommend(input),
);
