import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner";
import type {
  BetaMessage,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { BetaRunnableTool } from "../tools/index.js";
import type { AlertContext } from "../tools/types.js";
import { wrapUntrusted } from "../tools/untrusted.js";
import { DEFAULT_HUNT_WINDOW_MINUTES } from "./prompt.js";

export const MODEL = "claude-opus-5-5";
export const REMINDER = "Call submit_verdict now.";
export const REMINDER_ITERATIONS = 3;

export type ToolRunnerParams = BetaToolRunnerParams;

/** A runner is iterable; the real SDK runner also exposes its history. */
export type Runner = AsyncIterable<BetaMessage> & {
  readonly params?: { readonly messages: BetaMessageParam[] };
};
export type RunnerFactory = (params: ToolRunnerParams) => Runner;

export type RunInput = {
  mode: "investigate" | "hunt";
  alerts: AlertContext[];
  relatedTo?: string;
  huntWindowMinutes?: number;
};

/** The first user message: the task, with alert data fenced as untrusted. */
export function taskMessage(input: RunInput): BetaMessageParam {
  if (input.mode === "hunt") {
    const minutes = input.huntWindowMinutes ?? DEFAULT_HUNT_WINDOW_MINUTES;
    return {
      role: "user",
      content: `Hunt the cluster for the last ${minutes} minutes following the hunt brief, then submit your verdict(s).`,
    };
  }
  const related = input.relatedTo
    ? `\nThis alert may be related to an earlier investigation: ${JSON.stringify(input.relatedTo)}.`
    : "";
  return {
    role: "user",
    content: `Investigate the following alert(s) and submit one verdict.${related}\n${wrapUntrusted("alerts", JSON.stringify(input.alerts))}`,
  };
}

/** All request params for one runner, pinned to the lab's model settings. */
export function buildParams(args: {
  system: string;
  tools: BetaRunnableTool[];
  messages: BetaMessageParam[];
  maxIterations: number;
}): ToolRunnerParams {
  return {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    max_iterations: args.maxIterations,
    system: [
      {
        type: "text",
        text: args.system,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: args.tools,
    messages: args.messages,
  };
}
