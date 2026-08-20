import { loadConfig } from "./config.js";
import { sendBeacon } from "./egress/beacon.js";
import { pinnedCheckin } from "./egress/pinned.js";
import { checkForUpdate } from "./egress/updateCheck.js";
import { buildFingerprint } from "./fingerprint.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "suspect-app" });
installGlobalErrorHandlers(logger);

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const fingerprint = buildFingerprint();

  await checkForUpdate(cfg, logger);
  for (const url of cfg.beaconUrls) {
    await sendBeacon(url, fingerprint, logger);
  }
  await pinnedCheckin(cfg, logger);

  // Let the gateway flush its capture before we exit and the stack tears down.
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
