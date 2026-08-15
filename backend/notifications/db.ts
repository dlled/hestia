import { SQLDatabase } from "encore.dev/storage/sqldb";

export const notificationsDB = new SQLDatabase("notifications", {
  migrations: "./migrations",
});
