import { SQLDatabase } from "encore.dev/storage/sqldb";

export const automationDB = new SQLDatabase("automation", {
  migrations: "./migrations",
});
