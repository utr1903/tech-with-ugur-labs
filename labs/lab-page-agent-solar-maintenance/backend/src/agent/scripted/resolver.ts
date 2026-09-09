import type { ChatMessage } from "../guard.js";
import type { AgentAction } from "./envelope.js";
import { INTENTS, onReportsList, SUBMIT_GOAL } from "./intents.js";
import { type AgentView, didGoal, parseAgentView } from "./prompt.js";

export interface ResolvedStep {
  nextGoal: string;
  action: AgentAction;
}

/** No intent applies to this page — distinct from "the task is finished". */
const NO_INTENT = Symbol("no-intent");

function done(text: string, success: boolean): ResolvedStep {
  return { nextGoal: text, action: { done: { text, success } } };
}

function nextStep(
  view: AgentView,
  today: string,
): ResolvedStep | typeof NO_INTENT {
  for (const intent of INTENTS) {
    if (!intent.when(view.url)) continue;
    if (intent.satisfied(view)) continue;
    const element = intent.locate(view);
    if (!element) continue;
    return { nextGoal: intent.goal, action: intent.act(element, today) };
  }
  return NO_INTENT;
}

/**
 * The scripted transport's whole brain: a pure function from one request to one
 * action. It re-reads the live DOM every step and resolves intents to indices
 * then and there, so it is unaffected by elements appearing, disappearing, or
 * being renumbered — which a recorded tape of tool calls would not be.
 *
 * Success is confirmed POSITIVELY — we are on the reports list and the submit
 * step actually succeeded. The tempting alternative, "no intent applies to this
 * page, so we must be finished", reports a filed report for any page it fails
 * to recognise, including a request it could not parse at all.
 */
export function resolveNextAction(
  messages: ChatMessage[],
  today: string,
): ResolvedStep {
  const view = parseAgentView(messages);

  if (view.url === "") {
    return done(
      "Could not read the current page from the agent's request.",
      false,
    );
  }
  if (onReportsList(view.url) && didGoal(view, SUBMIT_GOAL)) {
    return done(
      "Filed the maintenance report for the Almeria Roof Array.",
      true,
    );
  }

  const step = nextStep(view, today);
  if (step === NO_INTENT) {
    return done(
      `Could not find the next control to use on ${view.url}.`,
      false,
    );
  }
  return step;
}
