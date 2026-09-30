import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Logger } from "../logger.js";
import { failedResult } from "../research/agent-result.js";
import { type RunResult, runResearch } from "../research/agent.js";
import type { ResearchTools } from "../research/firecrawl-types.js";
import { type ResearchRequest, readRequest } from "../research/input.js";
import { createLedger } from "../research/ledger.js";
import { createReportRuntime } from "./report-runtime.js";

interface ReportOptions {
  urlsFile?: string;
  outputDirectory?: string;
  createRuntime?: (
    request: ResearchRequest,
    logger: Logger,
  ) => { model: BaseChatModel; tools: ResearchTools };
}
export async function runReport(
  instruction: string,
  logger: Logger,
  options: ReportOptions = {},
): Promise<RunResult> {
  const urlsFile = options.urlsFile ?? "workspace/input/urls.txt";
  const outputDirectory = options.outputDirectory ?? "workspace/output";
  try {
    logger.info(
      { instructionLength: instruction.length },
      "Running report command...",
    );
    if (!instruction.trim())
      throw new Error("A research instruction is required.");
    const request = await readRequest(instruction, urlsFile);
    const result = await research(request, logger, options);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "report.md"), result.report, "utf8");
    await writeFile(
      join(outputDirectory, "coverage.json"),
      `${JSON.stringify(result.coverage, null, 2)}\n`,
      "utf8",
    );
    logger.info(
      { exitCode: result.exitCode },
      "Running report command succeeded.",
    );
    return result;
  } catch (err) {
    logger.error(
      { err: new Error("Report command failed") },
      "Running report command failed.",
    );
    throw err;
  }
}
async function research(
  request: ResearchRequest,
  logger: Logger,
  options: ReportOptions,
): Promise<RunResult> {
  let runtime:
    | ReturnType<typeof createReportRuntime>
    | { model: BaseChatModel; tools: ResearchTools };
  try {
    runtime = (options.createRuntime ?? createReportRuntime)(request, logger);
  } catch (err) {
    logger.error(
      { err: new Error("Research configuration failed") },
      "Configuring research failed.",
    );
    return failedResult(
      request,
      createLedger(request).snapshot(),
      "Research configuration failed. Supply OPENAI_API_KEY and FIRECRAWL_API_KEY.",
    );
  }
  return runResearch(request, runtime.tools, runtime.model, logger);
}
