import { SQLDatabase } from "encore.dev/storage/sqldb";

export const energyDB = new SQLDatabase("energy", { migrations: "./migrations" });
