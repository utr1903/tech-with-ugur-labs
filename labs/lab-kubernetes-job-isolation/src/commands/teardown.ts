import { operation } from "../lib/operation.js";
import { createLogger, installGlobalErrorHandlers } from "../logger.js";
import { existingCluster } from "./cluster.js";
import { stopForwards } from "./forward.js";
import { createRunner } from "./process.js";
import { cluster } from "./settings.js";

const logger = createLogger({ appName: "job-isolation-teardown" });
installGlobalErrorHandlers(logger);
await operation(logger, "Tearing down lab", {}, async () => {
  await stopForwards();
  const run = createRunner(logger);
  if (await existingCluster(run))
    await run("kind", ["delete", "cluster", "--name", cluster]);
});
