import { SQLDatabase } from "encore.dev/storage/sqldb";

export const identityDB = new SQLDatabase("identity", {
  migrations: "./migrations",
});
