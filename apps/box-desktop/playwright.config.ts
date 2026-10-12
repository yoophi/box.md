import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: "http://127.0.0.1:18143",
    viewport: { width: 1100, height: 760 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 18143",
    url: "http://127.0.0.1:18143",
    reuseExistingServer: false,
  },
});
