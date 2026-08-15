import { SQLDatabase } from "encore.dev/storage/sqldb";

export const homeCoreDB = new SQLDatabase("home_core", {
  migrations: "./migrations",
});
