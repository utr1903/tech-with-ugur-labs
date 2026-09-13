import { operation } from "../lib/operation.js";
import { createLogger, installGlobalErrorHandlers } from "../logger.js";
import { existingCluster } from "./cluster.js";
import { stopForwards } from "./forward.js";
import { createRunner } from "./process.js";
import { cluster } from "./settings.js";

const logger = createLogger({ appName: "job-isolation-teardown" });
installGlobalErrorHandlers(logger);
await operation(logger, "Tearing down lab", {}, async () => {
  // Validate and stop recorded forwarding processes before removing their target cluster.
  await stopForwards(logger);
  const run = createRunner(logger);
  // Reuse the positive node/image/label ownership check before destructive cluster deletion.
  if (await existingCluster(run))
    await run("kind", ["delete", "cluster", "--name", cluster]);
});
