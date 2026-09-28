import { defineConfig } from "vitest/config";

/**
 * The test run configuration. Test files run one at a time, not in
 * parallel, because they all read and write the one `shop_test` database
 * that `src/db/test-setup.ts` recreates before the run.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "e2e/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["src/db/test-setup.ts"],
  },
});
