import { runBypassProbe } from "./commands/bypassProbe.js";
import { runEgressWorkload } from "./commands/run.js";
import { loadConfig } from "./config.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "client" });
installGlobalErrorHandlers(logger);

const command = process.argv[2];

if (command === "run") {
  await runEgressWorkload(loadConfig(process.env), logger);
  process.exit(0);
} else if (command === "bypass-probe") {
  const ip = process.argv[3];
  const port = Number(process.argv[4] ?? 8080);
  if (!ip) {
    logger.error(
      {},
      "The bypass probe needs an IP address: bypass-probe <ip> [port].",
    );
    process.exit(2);
  }
  process.exit(await runBypassProbe({ ip, port, timeoutMs: 5000, logger }));
} else {
  logger.error(
    { command },
    "Unknown command (expected 'run' or 'bypass-probe').",
  );
  process.exit(2);
}
