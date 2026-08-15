#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = path.join(root, "infra/migrations");
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://hestia:hestia@localhost:5432/hestia";

const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

for (const file of files) {
  const sqlPath = path.join(migrationsDir, file);
  const sql = await readFile(sqlPath, "utf8");
  await runPsql(sql);
  console.log(`applied ${file}`);
}

function runPsql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1"], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.stdin.write(sql);
    child.stdin.end();
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`psql exited ${code}`));
      }
    });
  });
}
