import { createCollector } from "./collector.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";

const logger = createLogger({ appName: "attacker" });
installGlobalErrorHandlers(logger);

const httpPort = Number(process.env.COLLECTOR_PORT ?? 9000);
const httpEvidenceFile =
  process.env.HTTP_EVIDENCE_FILE ?? "/evidence/attacker_http.log";

const collector = createCollector({ logger, evidenceFile: httpEvidenceFile });
collector.listen(httpPort, () => {
  logger.info({ port: httpPort }, "Exfil collector listening...");
});
