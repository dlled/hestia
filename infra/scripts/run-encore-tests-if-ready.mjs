import { spawnSync } from "node:child_process";

if (!process.env.ENCORE_RUNTIME_LIB) {
  process.stdout.write("Encore service tests skipped outside `encore test`\n");
  process.exit(0);
}

const result = spawnSync("pnpm", ["test:encore-services"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
