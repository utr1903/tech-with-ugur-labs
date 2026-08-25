import { runDedup } from "./commands/dedup.js";
import { runEquivalence } from "./commands/equivalence.js";
import { runFailover } from "./commands/failover.js";
import { runGrafana } from "./commands/grafana.js";
import { runPartiality } from "./commands/partiality.js";
import { runReadiness } from "./commands/readiness.js";
import { loadConfig } from "./config.js";
import type { Ctx } from "./context.js";
import { Kubectl } from "./kube/kubectl.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { PromClient } from "./prom/client.js";

const logger = createLogger({ appName: "thanos-ha-verifier" });
installGlobalErrorHandlers(logger);

const cfg = loadConfig(process.env);
const ctx: Ctx = {
  cfg,
  logger,
  vanilla: new PromClient({ baseUrl: cfg.vanillaPromUrl, logger }),
  thanos: new PromClient({ baseUrl: cfg.thanosQueryUrl, logger }),
  shard0: new PromClient({ baseUrl: cfg.shard0PromUrl, logger }),
  shard1: new PromClient({ baseUrl: cfg.shard1PromUrl, logger }),
  kube: new Kubectl({ logger }),
};

const commands: [string, (ctx: Ctx) => Promise<void>][] = [
  ["readiness", runReadiness],
  ["equivalence", runEquivalence],
  ["partiality", runPartiality],
  ["dedup", runDedup],
  ["failover", runFailover],
  ["grafana", runGrafana],
];

const requested = process.argv[2] ?? "all";
const toRun =
  requested === "all"
    ? commands
    : commands.filter(([name]) => name === requested);
if (toRun.length === 0) {
  logger.error(
    { requested, available: commands.map(([n]) => n) },
    "Unknown command.",
  );
  process.exit(2);
}
for (const [name, run] of toRun) {
  logger.info({ command: name }, "Running verification command...");
  await run(ctx);
}
logger.info({ requested }, "Verification suite succeeded.");
