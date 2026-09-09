import type { AgentAction } from "./envelope.js";
import type { AgentView, PageElement } from "./prompt.js";
import { didGoal, findByAttr, findByText } from "./prompt.js";

export interface Intent {
  /** Unique — it is also the key `didGoal` matches on in the agent history. */
  goal: string;
  /** Runs only when the current URL matches. */
  when: (url: string) => boolean;
  /** Already done? Then skip it. */
  satisfied: (view: AgentView) => boolean;
  locate: (view: AgentView) => PageElement | undefined;
  act: (element: PageElement, today: string) => AgentAction;
}

const onSites = (url: string) => /\/sites$/.test(url);
const onSiteDetail = (url: string) => /\/sites\/almeria-roof$/.test(url);
const onReport = (url: string) => /\/sites\/almeria-roof\/report$/.test(url);

/** The app lands here once the form is submitted. */
export const onReportsList = (url: string) => /\/reports$/.test(url);

/** Shared with the resolver, which confirms success by looking for it. */
export const SUBMIT_GOAL = "Submit the report";

/** A field intent: located by its `name`, considered done via the history. */
function fillField(
  goal: string,
  name: string,
  act: (element: PageElement, today: string) => AgentAction,
): Intent {
  return {
    goal,
    when: onReport,
    satisfied: (view) => didGoal(view, goal),
    locate: (view) => findByAttr(view, "name", name),
    act,
  };
}

const typeInto =
  (text: string) =>
  (element: PageElement): AgentAction => ({
    input_text: { index: element.index, text },
  });

export const INTENTS: Intent[] = [
  {
    goal: "Open the Almeria Roof Array site",
    when: onSites,
    satisfied: (view) => !onSites(view.url),
    locate: (view) => findByText(view, "Almeria Roof Array"),
    act: (element) => ({ click_element_by_index: { index: element.index } }),
  },
  {
    goal: "Open the maintenance report form",
    when: onSiteDetail,
    satisfied: (view) => onReport(view.url),
    locate: (view) => findByText(view, "File a report"),
    act: (element) => ({ click_element_by_index: { index: element.index } }),
  },
  fillField("Choose the component", "component", (element) => ({
    select_dropdown_option: { index: element.index, text: "Inverter" },
  })),
  fillField(
    "Name the unit that was worked on",
    "component-ref",
    typeInto("String 3 inverter"),
  ),
  fillField("Set the work date to today", "work-date", (element, today) => ({
    input_text: { index: element.index, text: today },
  })),
  fillField("Record how long it took", "duration-hours", typeInto("2")),
  fillField(
    "Summarise the work",
    "summary",
    typeInto("Replaced the string 3 inverter fan."),
  ),
  {
    // `checked` is the one attribute the walker overwrites with the live
    // property, so here the DOM really can answer the question.
    goal: "Flag that a follow-up is needed",
    when: onReport,
    satisfied: (view) =>
      findByAttr(view, "name", "follow-up-required")?.attrs.checked === "true",
    locate: (view) => findByAttr(view, "name", "follow-up-required"),
    act: (element) => ({ click_element_by_index: { index: element.index } }),
  },
  // Only locatable once the checkbox above revealed the field.
  fillField(
    "Say what the follow-up is",
    "follow-up-note",
    typeInto("Panel 14 still shows a hotspot."),
  ),
  {
    goal: SUBMIT_GOAL,
    when: onReport,
    satisfied: (view) => !onReport(view.url),
    locate: (view) => findByAttr(view, "name", "submit-report"),
    act: (element) => ({ click_element_by_index: { index: element.index } }),
  },
];
