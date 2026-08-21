import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseBlocklist } from "../blocklist.js";
import type { AnalyzerConfig } from "../config.js";
import { parseEvents } from "../events.js";
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
  const events = parseEvents(readOr(cfg.eventsPath, ""));
  const blocklist = parseBlocklist(readFileSync(cfg.blocklistPath, "utf8"));
  const report = buildReport(events, blocklist);

  mkdirSync(dirname(cfg.reportPath), { recursive: true });
  writeFileSync(cfg.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  logger.info(
    { path: cfg.reportPath, rows: report.rows.length },
    "Building egress report succeeded.",
  );
  process.stdout.write(`\n${renderTable(report)}\n\n`);
}
