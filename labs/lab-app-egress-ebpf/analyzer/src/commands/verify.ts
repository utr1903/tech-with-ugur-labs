import { readFileSync } from "node:fs";
import type { AnalyzerConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { Report } from "../report.js";
import { type ComposeConfig, verifyReport } from "../verify.js";

export function runVerify(cfg: AnalyzerConfig, logger: Logger): number {
  const report = JSON.parse(readFileSync(cfg.reportPath, "utf8")) as Report;
  const compose = JSON.parse(readFileSync(cfg.composeConfigPath, "utf8")) as ComposeConfig;
  const { ok, failures } = verifyReport(report, compose);
  if (ok) {
    logger.info({ path: cfg.reportPath }, "Report verification succeeded.");
    return 0;
  }
  logger.error({ failures }, "Report verification failed.");
  return 1;
}
