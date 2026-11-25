import { runReport } from "./batch/report.js";
import { runCiRunner } from "./ci/runner.js";
import { createPool } from "./db/pool.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { startPaymentsServer } from "./payments/server.js";
import { startStorefrontServer } from "./storefront/server.js";

const role = process.argv[2];
const logger = createLogger({ appName: role ?? "tenants" });
installGlobalErrorHandlers(logger);

const port = Number(process.env.PORT ?? 8080);

async function main(): Promise<void> {
  switch (role) {
    case "storefront":
      startStorefrontServer(logger, port);
      return;
    case "payments-api":
      startPaymentsServer(logger, createPool(logger), port);
      return;
    case "nightly-report": {
      const pool = createPool(logger);
      try {
        await runReport(logger, pool);
      } finally {
        await pool.end();
      }
      return;
    }
    case "ci-runner":
      runCiRunner(logger, createPool(logger));
      return;
    default:
      logger.error(
        { role },
        "Starting tenant failed: expected storefront|payments-api|nightly-report|ci-runner.",
      );
      process.exit(1);
  }
}

await main();
