import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Logger } from "../../logger.js";
import type { Runner } from "./request.js";
import { addUsage, type Usage } from "./usage.js";

export type Consumed = {
  usage: Usage;
  last: BetaMessage | undefined;
  budgetExhausted: boolean;
};

/**
 * Drains one runner turn by turn. Logs every model turn (start, success,
 * failure) and stops as soon as cumulative input+output tokens exceed the
 * budget, so a runaway loop cannot spend without bound.
 */
export async function consume(
  runner: Runner,
  start: Usage,
  tokenBudget: number,
  logger: Logger,
): Promise<Consumed> {
  const it = runner[Symbol.asyncIterator]();
  let usage = start;
  let last: BetaMessage | undefined;
  let budgetExhausted = false;
  for (;;) {
    const turn = usage.iterations + 1;
    let next: IteratorResult<BetaMessage>;
    try {
      logger.info({ turn }, "Model turn...");
      next = await it.next();
    } catch (err) {
      logger.error({ err, turn }, "Model turn failed.");
      throw err;
    }
    if (next.done) break;
    last = next.value;
    usage = addUsage(usage, last);
    logger.info(
      { turn, stop_reason: last.stop_reason, usage },
      "Model turn succeeded.",
    );
    if (usage.input_tokens + usage.output_tokens > tokenBudget) {
      budgetExhausted = true;
      logger.warn({ tokenBudget, usage }, "Token budget exhausted.");
      // The SDK runs a reply's tools only when asked for the next turn, so
      // run this turn's tools now (a verdict made on it must count), then
      // stop without another model request.
      if (last.stop_reason === "tool_use")
        await runner.generateToolResponse?.();
      await it.return?.();
      break;
    }
  }
  return { usage, last, budgetExhausted };
}
