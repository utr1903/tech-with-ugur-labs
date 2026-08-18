import path from "node:path";
import readline from "node:readline/promises";
import { buildAnalyzeAgent } from "../agents/analyze-agent.js";
import { buildChatModel } from "../agents/model.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

const ANALYZE_MAX_STEPS = 25;

export function extractAnswer(result: {
  messages: Array<{ text?: string }>;
}): string {
  return result.messages.at(-1)?.text ?? "";
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
      const answer = await runAnalyzeQuestion({ question, config, logger });
      process.stderr.write(`\n${answer}\n\n`);
    }
  } finally {
    rl.close();
  }
}
