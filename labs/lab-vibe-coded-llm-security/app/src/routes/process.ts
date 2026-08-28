import type { RequestHandler } from "express";
import type { AppConfig } from "../config.js";
import { runGeneratedCommand } from "../exec/run-generated.js";
import type { Logger } from "../logger.js";
import { buildProcessPrompt } from "../model/prompts.js";

export interface ProcessDeps {
  config: AppConfig;
  logger: Logger;
  chatFn: (prompt: string) => Promise<string>;
  execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
}

interface ProcessRequestBody {
  instruction: string;
  data: string;
}

interface ClassificationResult {
  category: string;
}

export function createProcessHandler(deps: ProcessDeps): RequestHandler {
  const { config, logger, chatFn, execFn } = deps;

  return async (req, res) => {
    const { instruction, data } = req.body as ProcessRequestBody;

    try {
      logger.info({ variant: config.variant }, "Processing data...");
      const prompt = buildProcessPrompt({
        variant: config.variant,
        instruction,
        data,
      });
      const modelOutput = await chatFn(prompt);

      let result: string;
      if (config.variant === "vulnerable") {
        // DELIBERATELY VULNERABLE: executes the shell command the model emitted
        // from untrusted data verbatim (the RCE sink).
        const stdout = await runGeneratedCommand(
          { logger, execFn },
          modelOutput,
        );
        result = stdout.length > 0 ? stdout : "(command produced no output)";
      } else {
        const parsed = JSON.parse(modelOutput) as ClassificationResult;
        result = `classified as ${parsed.category}`;
      }

      logger.info({ variant: config.variant }, "Processing data succeeded.");
      res.json({ result });
    } catch (err) {
      logger.error({ err, variant: config.variant }, "Processing data failed.");
      res.status(500).json({ error: "process request failed" });
    }
  };
}
