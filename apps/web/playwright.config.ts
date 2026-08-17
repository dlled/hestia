import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.HESTIA_WEB_URL ?? "http://127.0.0.1:5173",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "../../output/playwright/identity",
  projects: [
    {
      name: "chrome-passkeys",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
