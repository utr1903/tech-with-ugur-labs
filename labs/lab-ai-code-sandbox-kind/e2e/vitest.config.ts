import { defineConfig } from "vitest/config";

// One file at a time: the persistence test restarts the server pod and the
// saturation test fills every sandbox slot.
export default defineConfig({
  test: {
    include: ["src/scripted/**/*.e2e.test.ts"],
    globalSetup: ["src/support/global-setup.ts"],
    provide: { expectedLlmMode: "scripted" },
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    reporters: ["default", "json"],
    outputFile: { json: "reports/e2e-report.json" },
  },
});
