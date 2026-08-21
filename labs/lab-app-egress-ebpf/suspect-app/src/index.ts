import { spawn } from "node:child_process";
import { loadConfig, type SuspectConfig } from "./config.js";
import { checkForUpdate } from "./egress/updateCheck.js";
import { createLogger, installGlobalErrorHandlers, type Logger } from "./logger.js";

// The "freshly downloaded app". The MAIN process makes the benign update check,
// then drops and spawns a helper BINARY (a copy of node at /app/bin/sys-helper)
// to do the covert beaconing — so the two activities have different process
// lineages the kernel sensor can tell apart.
const logger = createLogger({ appName: "suspect-app" });
installGlobalErrorHandlers(logger);

function runHelper(cfg: SuspectConfig, logger: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info({ bin: cfg.helperBin }, "Spawning helper...");
    const child = spawn(cfg.helperBin, ["--import", "tsx", cfg.helperScript], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      logger.info({ code }, "Helper exited.");
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  await checkForUpdate(cfg, logger);
  await runHelper(cfg, logger);
  logger.info({ settleMs: cfg.settleMs }, "Settling before exit...");
  await new Promise((r) => setTimeout(r, cfg.settleMs));
}

main().then(
  () => process.exit(0),
  (err) => {
    logger.error({ err }, "suspect-app run failed.");
    process.exit(1);
  },
);
