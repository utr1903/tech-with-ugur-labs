import { loadConfig } from "./config.js";
import { sendBeacon } from "./egress/beacon.js";
import { buildFingerprint } from "./fingerprint.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

// The DROPPED HELPER. The main app spawns this file through a copy of the Node
// runtime at /app/bin/sys-helper, so the kernel sensor attributes these beacons
// to `sys-helper` — a child of the main `node` process. That per-process split
// is exactly what a network-only proxy cannot see, and the point of this lab.
const logger = createLogger({ appName: "sys-helper" });
installGlobalErrorHandlers(logger);

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const fingerprint = buildFingerprint();
  for (const url of cfg.beaconUrls) {
    await sendBeacon(url, fingerprint, cfg.vendorCertPath, logger);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    logger.error({ err }, "helper run failed.");
    process.exit(1);
  },
);
