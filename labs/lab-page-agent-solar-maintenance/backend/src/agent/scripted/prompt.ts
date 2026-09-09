import type { ChatMessage } from "../guard.js";

export interface PageElement {
  index: number;
  tag: string;
  text: string;
  attrs: Record<string, string>;
  isNew: boolean;
}

// Not exported: nothing outside this file names the type — consumers read
// `view.history` and get the shape structurally — see the same precedent in
// config.ts (LlmMode) and guard.ts's own history with ChatMessage/ChatRequest.
interface HistoryStep {
  goal: string;
  result: string;
}

export interface AgentView {
  url: string;
  task: string;
  stepCount: number;
  elements: PageElement[];
  history: HistoryStep[];
}

/**
 * One element record. Verified against real output from the library's own
 * walker in Chromium — do NOT simplify this to a per-line scan.
 *
 *   [3]<input type=text name=component-ref />        attributes, no text, no ">"
 *   [14]<button type=submit name=submit-report>Submit report />
 *   [1]<select name=component>Choose a component     <-- text spans THREE lines
 *   Inverter
 *   Panel string />
 *   *[13]<input type=text name=follow-up-note />     "*" marks a new element
 *
 * A `<select>`'s text is its option list, so its record is always multi-line.
 * Splitting the content by "\n" and matching per line drops exactly that
 * element — the one the component intent needs. Hence a single global,
 * multiline regex whose text group is allowed to run across newlines until it
 * reaches a ` />` at an end of line.
 */
const ELEMENT_RECORD =
  /^[ \t]*(\*)?\[(\d+)\]<([a-zA-Z0-9-]+)((?:[^>\n]*?))(?:>([\s\S]*?))?[ \t]*\/>$/gm;
const TRUNCATED = "...";

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const pair of raw.trim().split(/\s+/)) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    attrs[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return attrs;
}

function parseElements(content: string): PageElement[] {
  const elements: PageElement[] = [];
  for (const match of content.matchAll(ELEMENT_RECORD)) {
    const [, star, index, tag, rawAttrs, text] = match;
    elements.push({
      index: Number(index),
      tag: (tag ?? "").toLowerCase(),
      text: (text ?? "").trim(),
      attrs: parseAttrs(rawAttrs ?? ""),
      isNew: star === "*",
    });
  }
  return elements;
}

function between(content: string, open: string, close: string): string {
  const start = content.indexOf(open);
  const end = content.indexOf(close);
  if (start === -1 || end === -1) return "";
  return content.slice(start + open.length, end).trim();
}

const STEP_BLOCK = /<step_\d+>([\s\S]*?)<\/step_\d+>/g;

function parseHistory(content: string): HistoryStep[] {
  const steps: HistoryStep[] = [];
  // Scoped to the history block, like <user_request>, so a step-shaped string
  // appearing in page text can never be read as a completed step.
  const history = between(content, "<agent_history>", "</agent_history>");
  for (const [, block = ""] of history.matchAll(STEP_BLOCK)) {
    steps.push({
      goal: /^Next Goal:[ \t]*(.*)$/m.exec(block)?.[1]?.trim() ?? "",
      result: /^Action Results:[ \t]*(.*)$/m.exec(block)?.[1]?.trim() ?? "",
    });
  }
  return steps;
}

export function parseAgentView(messages: ChatMessage[]): AgentView {
  const user = [...messages].reverse().find((m) => m.role === "user");
  if (!user || typeof user.content !== "string") {
    throw new Error("The agent request carries no user message to read.");
  }
  const content = user.content;
  const url = /Current Page: \[[^\]]*\]\(([^)]+)\)/.exec(content)?.[1] ?? "";
  const history = parseHistory(content);
  return {
    url,
    task: between(content, "<user_request>", "</user_request>"),
    stepCount: history.length,
    elements: parseElements(content),
    history,
  };
}

/**
 * Has this goal already been achieved? Read from the agent's own history rather
 * than from the DOM: the walker reports HTML attributes, and a React-controlled
 * input's `value` attribute never changes, so the page cannot tell us what is
 * already typed into it. The library's action results are unambiguous — "✅" on
 * success, "❌" on failure — so a step that ran and failed is not counted, and
 * its goal gets retried.
 */
export function didGoal(view: AgentView, goal: string): boolean {
  return view.history.some(
    (step) => step.goal === goal && step.result.startsWith("✅"),
  );
}

export function findByAttr(
  view: AgentView,
  attr: string,
  value: string,
): PageElement | undefined {
  return view.elements.find((element) => {
    const actual = element.attrs[attr];
    if (actual === undefined) return false;
    if (actual === value) return true;
    // The library caps attribute values at 20 characters and appends "...".
    if (!actual.endsWith(TRUNCATED)) return false;
    return value.startsWith(actual.slice(0, -TRUNCATED.length));
  });
}

export function findByText(
  view: AgentView,
  text: string,
): PageElement | undefined {
  const needle = text.trim().toLowerCase();
  return view.elements.find((element) =>
    element.text.toLowerCase().includes(needle),
  );
}
