import { SQLDatabase } from "encore.dev/storage/sqldb";

export const integrationHubDB = new SQLDatabase("integration_hub", {
  migrations: "./migrations",
});
