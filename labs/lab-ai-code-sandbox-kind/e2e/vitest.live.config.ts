import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/live/**/*.e2e.test.ts"],
    globalSetup: ["src/support/global-setup.ts"],
    provide: { expectedLlmMode: "live" },
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
    reporters: ["default", "json"],
    outputFile: { json: "reports/e2e-live-report.json" },
  },
});
