import type { ChatMessage } from "../guard.js";
import type { AgentAction } from "./envelope.js";
import { INTENTS } from "./intents.js";
import { type AgentView, parseAgentView } from "./prompt.js";

export interface ResolvedStep {
  nextGoal: string;
  action: AgentAction;
}

function done(text: string, success: boolean): ResolvedStep {
  return { nextGoal: text, action: { done: { text, success } } };
}

function nextStep(view: AgentView, today: string): ResolvedStep {
  for (const intent of INTENTS) {
    if (!intent.when(view.url)) continue;
    if (intent.satisfied(view)) continue;
    const element = intent.locate(view);
    if (!element) continue;
    return { nextGoal: intent.goal, action: intent.act(element, today) };
  }
  return done("", true);
}

/**
 * The scripted transport's whole brain: a pure function from one request to one
 * action. It re-reads the live DOM every step and resolves intents to indices
 * then and there, so it is unaffected by elements appearing, disappearing, or
 * being renumbered — which a recorded tape of tool calls would not be.
 */
export function resolveNextAction(
  messages: ChatMessage[],
  today: string,
): ResolvedStep {
  const view = parseAgentView(messages);

  const everyIntentDone = INTENTS.every(
    (intent) => !intent.when(view.url) || intent.satisfied(view),
  );
  if (everyIntentDone) {
    return done(
      "Filed the maintenance report for the Almeria Roof Array.",
      true,
    );
  }

  const step = nextStep(view, today);
  if ("done" in step.action) {
    return done(
      `Could not find the next control to use on ${view.url}.`,
      false,
    );
  }
  return step;
}
