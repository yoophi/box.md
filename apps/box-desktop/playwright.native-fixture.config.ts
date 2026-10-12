import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/native",
  testMatch: "**/*.spec.mjs",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: { viewport: { width: 1100, height: 760 }, trace: "retain-on-failure" },
});
