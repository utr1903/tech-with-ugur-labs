import { createCollector } from "./collector.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { createShellListener } from "./shell-listener.js";

const logger = createLogger({ appName: "attacker" });
installGlobalErrorHandlers(logger);

const httpPort = Number(process.env.COLLECTOR_PORT ?? 9000);
const httpEvidenceFile =
  process.env.HTTP_EVIDENCE_FILE ?? "/evidence/attacker_http.log";

const shellPort = Number(process.env.SHELL_LISTENER_PORT ?? 9001);
const shellEvidenceFile =
  process.env.SHELL_EVIDENCE_FILE ?? "/evidence/attacker_shell.log";

const collector = createCollector({ logger, evidenceFile: httpEvidenceFile });
collector.listen(httpPort, () => {
  logger.info({ port: httpPort }, "Exfil collector listening...");
});

const shellListener = createShellListener({
  logger,
  evidenceFile: shellEvidenceFile,
});
shellListener.listen(shellPort, () => {
  logger.info({ port: shellPort }, "Reverse-shell listener listening...");
});
