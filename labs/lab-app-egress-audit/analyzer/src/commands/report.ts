import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseBlocklist } from "../blocklist.js";
import { parseCapture } from "../capture.js";
import type { AnalyzerConfig } from "../config.js";
import { parseDnsQueries } from "../dnsLog.js";
import type { Logger } from "../logger.js";
import { buildReport, renderTable } from "../report.js";

function readOr(path: string, fallback: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}

export function runReport(cfg: AnalyzerConfig, logger: Logger): void {
  logger.info({ cfg }, "Building egress report...");
  const dns = parseDnsQueries(readOr(cfg.dnsLogPath, ""));
  const evidence = parseCapture(readOr(cfg.capturePath, ""));
  const blocklist = parseBlocklist(readFileSync(cfg.blocklistPath, "utf8"));
  const report = buildReport(dns, evidence, blocklist);

  mkdirSync(dirname(cfg.reportPath), { recursive: true });
  writeFileSync(cfg.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  logger.info(
    { path: cfg.reportPath, domains: report.domains.length },
    "Building egress report succeeded.",
  );
  process.stdout.write(`\n${renderTable(report)}\n\n`);
}
