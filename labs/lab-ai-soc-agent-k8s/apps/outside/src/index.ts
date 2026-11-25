import { networkInterfaces } from "node:os";
import { runLoadgen } from "./loadgen/loop.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { HitStore } from "./sinks/hits.js";
import { createSinkServer } from "./sinks/server.js";

const role = process.argv[2];
const logger = createLogger({ appName: role ?? "outside" });
installGlobalErrorHandlers(logger);

/** The container's own address on the kind network - no hard-coded subnet. */
function ownIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  throw new Error("no non-loopback IPv4 address found");
}

async function main(): Promise<void> {
  switch (role) {
    case "sinks": {
      const attackerIp = ownIp();
      const scenariosDir = process.env.SCENARIOS_DIR ?? "/scenarios";
      const store = new HitStore();
      for (const port of [8080, 8443]) {
        createSinkServer(logger, { scenariosDir, attackerIp, store }).listen(
          port,
          () => logger.info({ port, attackerIp }, "Starting sinks succeeded."),
        );
      }
      return;
    }
    case "loadgen":
      await runLoadgen(
        logger,
        process.env.TARGET ?? "http://ai-soc-worker:30080",
      );
      return;
    default:
      logger.error(
        { role },
        "Starting outside failed: expected sinks|loadgen.",
      );
      process.exit(1);
  }
}

await main();
