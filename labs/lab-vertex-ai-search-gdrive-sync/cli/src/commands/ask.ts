import { type LabConfig, servingConfigPath } from "../config/config.js";
import type { Logger } from "../logger.js";
import { type AnswerResult, askQuestion } from "../search/answer.js";
import { conversationalClient } from "../search/clients.js";
import { writeLine } from "./output.js";

export function formatAnswer(result: AnswerResult, options: { raw: boolean }): string[] {
  const lines = ["", result.text || "(no answer)", ""];

  lines.push(`grounding score: ${result.groundingScore ?? "n/a"}`);
  if (result.skippedReasons.length > 0) {
    lines.push(`skipped: ${result.skippedReasons.join(", ")}`);
  }

  lines.push(result.citedUris.length > 0 ? "citations:" : "citations: none");
  for (const uri of result.citedUris) {
    lines.push(`  - ${uri}`);
  }

  if (result.supports.length > 0) {
    lines.push("per-claim grounding:");
    for (const support of result.supports) {
      lines.push(`  - ${support.score ?? "n/a"} from ${support.uris.join(", ") || "nothing"}`);
    }
  }

  if (options.raw) {
    lines.push("", "retrieved chunks:");
    for (const chunk of result.chunks) {
      lines.push(`  - [${chunk.relevanceScore ?? "n/a"}] ${chunk.uri}`);
      lines.push(`    ${chunk.content.replace(/\s+/g, " ").slice(0, 300)}`);
    }
  }

  return lines;
}

export async function runAsk(
  config: LabConfig,
  question: string,
  options: { raw: boolean },
  logger: Logger,
): Promise<void> {
  const result = await askQuestion(
    conversationalClient(config),
    servingConfigPath(config),
    question,
    {},
    logger,
  );

  for (const line of formatAnswer(result, options)) {
    writeLine(line);
  }
}
