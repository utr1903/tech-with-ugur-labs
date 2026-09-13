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
    await prerequisites(run);
    await deploy(run);
    await startForwards();
  },
  () => ({
    insecure: "http://127.0.0.1:3000/execute",
    secure: "http://127.0.0.1:3001/execute",
  }),
);
