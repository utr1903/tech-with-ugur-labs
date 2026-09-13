import { operation } from "../lib/operation.js";
import { createLogger, installGlobalErrorHandlers } from "../logger.js";
import { deploy } from "./deployment.js";
import { startForwards } from "./forward.js";
import { prerequisites } from "./prerequisites.js";
import { createRunner } from "./process.js";

const logger = createLogger({ appName: "job-isolation-bootstrap" });
installGlobalErrorHandlers(logger);
const run = createRunner(logger);
await operation(
  logger,
  "Bootstrapping lab",
  {},
  async () => {
    // Fail before setup mutations if the pinned toolchain or Linux Docker engine is unavailable.
    await prerequisites(run);
    // Finish cluster/CNI/image/release setup before opening localhost access.
    await deploy(run);
    // Expose only the owned ready services through recorded localhost port forwards.
    await startForwards(logger);
  },
  () => ({
    insecure: "http://127.0.0.1:3000/execute",
    secure: "http://127.0.0.1:3001/execute",
  }),
);
