import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.jsx"],
    globalSetup: [
      "../../vendor/agentic-workspace/packages/workbench-client/src/test/integration/global-setup.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
