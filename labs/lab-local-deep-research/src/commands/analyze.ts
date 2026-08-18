import path from "node:path";
import readline from "node:readline/promises";
import { buildAnalyzeAgent } from "../agents/analyze-agent.js";
import { buildChatModel } from "../agents/model.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

const ANALYZE_MAX_STEPS = 25;

const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/g;
const THINK_CLOSE_TAG = "</think>";

// qwen3:4b sometimes leaks its internal reasoning into the final answer as
// <think>...</think>, or — when the opening tag is truncated away — as
// reasoning text ending in a stray </think> with no opener. Strip both so
// the human-facing answer never carries the model's internal monologue.
function stripThinkBlocks(text: string): string {
  const withoutClosedBlocks = text.replace(THINK_BLOCK_PATTERN, "");
  const lastCloseIndex = withoutClosedBlocks.lastIndexOf(THINK_CLOSE_TAG);
  const withoutLeadingReasoning =
    lastCloseIndex === -1
      ? withoutClosedBlocks
      : withoutClosedBlocks.slice(lastCloseIndex + THINK_CLOSE_TAG.length);
  return withoutLeadingReasoning.trim();
}

export function extractAnswer(result: {
  messages: Array<{ text?: string }>;
}): string {
  return stripThinkBlocks(result.messages.at(-1)?.text ?? "");
}

export async function runAnalyzeQuestion({
  question,
  config,
  logger,
}: {
  question: string;
  config: AppConfig;
  logger: Logger;
}): Promise<string> {
  try {
    logger.info({ question }, "Answering from research files...");
    const agent = buildAnalyzeAgent({
      model: buildChatModel(config),
      researchDir: path.resolve(config.researchDir),
    });
    const result = await agent.invoke(
      { messages: [{ role: "user", content: question }] },
      { recursionLimit: ANALYZE_MAX_STEPS },
    );
    const answer = extractAnswer(result);
    logger.info(
      { question, answer },
      "Answering from research files succeeded.",
    );
    return answer;
  } catch (err) {
    logger.error({ err, question }, "Answering from research files failed.");
    throw err;
  }
}

export async function runAnalyzeRepl({
  config,
  logger,
}: {
  config: AppConfig;
  logger: Logger;
}): Promise<void> {
  // The REPL talks to the human on stderr so stdout stays JSON logs only.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  process.stderr.write(
    "Ask about your researched topics (empty line to exit).\n",
  );
  try {
    for (;;) {
      const question = (await rl.question("ask> ")).trim();
      if (question === "") return;
      try {
        const answer = await runAnalyzeQuestion({ question, config, logger });
        process.stderr.write(`\n${answer}\n\n`);
      } catch {
        // runAnalyzeQuestion already logged the error — just keep the
        // session alive instead of letting one bad question kill it.
        process.stderr.write(
          "Something went wrong answering that — see the log line above. Ask again or press Enter to exit.\n",
        );
      }
    }
  } finally {
    rl.close();
  }
}
