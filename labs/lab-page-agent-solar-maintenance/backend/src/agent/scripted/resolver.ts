import type { ChatMessage } from "../guard.js";
import type { AgentAction } from "./envelope.js";
import { INTENTS, onReportsList, SUBMIT_GOAL, WAIT_GOAL } from "./intents.js";
import { type AgentView, didGoal, parseAgentView } from "./prompt.js";

export interface ResolvedStep {
  nextGoal: string;
  action: AgentAction;
}

/** No intent applies to this page — distinct from "the task is finished". */
const NO_INTENT = Symbol("no-intent");
/** An intent applies and is unsatisfied, but its control is not on the page yet. */
const NOT_RENDERED = Symbol("not-rendered");
/** Bounded, so a genuinely missing control still fails instead of hanging. */
const MAX_WAITS = 5;

function done(text: string, success: boolean): ResolvedStep {
  return { nextGoal: text, action: { done: { text, success } } };
}

function nextStep(
  view: AgentView,
  today: string,
): ResolvedStep | typeof NO_INTENT | typeof NOT_RENDERED {
  let sawUnsatisfied = false;
  for (const intent of INTENTS) {
    if (!intent.when(view.url)) continue;
    if (intent.satisfied(view)) continue;
    sawUnsatisfied = true;
    const element = intent.locate(view);
    if (!element) continue;
    return { nextGoal: intent.goal, action: intent.act(element, today) };
  }
  // Something here is still to do, but its control is missing: almost always
  // the route rendered before its data arrived.
  return sawUnsatisfied ? NOT_RENDERED : NO_INTENT;
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
  if (step === NOT_RENDERED) {
    // Count prior waits out of the history, so this stays a pure function.
    const waits = view.history.filter((s) => s.goal === WAIT_GOAL).length;
    if (waits < MAX_WAITS) {
      return { nextGoal: WAIT_GOAL, action: { wait: { seconds: 1 } } };
    }
    return done(
      `Waited, but never found the next control on ${view.url}.`,
      false,
    );
  }
  if (step === NO_INTENT) {
    return done(
      `Could not find the next control to use on ${view.url}.`,
      false,
    );
  }
  return step;
}
