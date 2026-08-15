import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~encore": fileURLToPath(new URL("./encore.gen", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["backend/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
