import { describe, expect, it } from "vitest";
import { resolveNextAction } from "./resolver.js";

/** `done` is the list of goals already achieved, rendered as history blocks. */
function request(url: string, elements: string, done: string[] = []) {
  const history = done
    .map(
      (goal, i) =>
        `<step_${i + 1}>\nNext Goal: ${goal}\nAction Results: ✅ did it.\n</step_${i + 1}>`,
    )
    .join("\n");
  return [
    { role: "system", content: "system" },
    {
      role: "user",
      content: `<agent_state>
<user_request>
file the report
</user_request>
</agent_state>
<agent_history>
${history}
</agent_history>
<browser_state>
Current Page: [Solar Logbook](${url})
${elements}
</browser_state>`,
    },
  ];
}

const TODAY = "2026-09-09";

describe("resolveNextAction", () => {
  it("clicks through to the site from the list", () => {
    const result = resolveNextAction(
      request("http://localhost:5173/sites", `[2]<a >Almeria Roof Array />`),
      TODAY,
    );
    expect(result.action).toEqual({ click_element_by_index: { index: 2 } });
  });

  it("opens the form from the site page", () => {
    const result = resolveNextAction(
      request(
        "http://localhost:5173/sites/almeria-roof",
        `[5]<a >File a report />`,
      ),
      TODAY,
    );
    expect(result.action).toEqual({ click_element_by_index: { index: 5 } });
  });

  it("selects the component first on an empty form", () => {
    const result = resolveNextAction(
      request(
        "http://localhost:5173/sites/almeria-roof/report",
        `[1]<select name=component />
[2]<input type=text name=component-ref />`,
      ),
      TODAY,
    );
    expect(result.action).toEqual({
      select_dropdown_option: { index: 1, text: "Inverter" },
    });
  });

  it("skips a field it has already filled, per its own history", () => {
    const result = resolveNextAction(
      request(
        "http://localhost:5173/sites/almeria-roof/report",
        `[1]<select name=component />
[2]<input type=text name=component-ref />`,
        ["Choose the component"],
      ),
      TODAY,
    );
    expect(result.action).toEqual({
      input_text: { index: 2, text: "String 3 inverter" },
    });
  });

  it("retries a field whose action failed", () => {
    const messages = request(
      "http://localhost:5173/sites/almeria-roof/report",
      `[1]<select name=component />`,
    );
    // Same goal, but the action came back with a failure marker.
    messages[1]!.content = (messages[1]!.content as string).replace(
      "<agent_history>\n",
      "<agent_history>\n<step_1>\nNext Goal: Choose the component\nAction Results: ❌ Failed to select option.\n</step_1>\n",
    );
    expect(resolveNextAction(messages, TODAY).action).toEqual({
      select_dropdown_option: { index: 1, text: "Inverter" },
    });
  });

  it("types the date it was given, never a hardcoded one", () => {
    const result = resolveNextAction(
      request(
        "http://localhost:5173/sites/almeria-roof/report",
        `[3]<input type=date name=work-date />`,
        ["Choose the component", "Name the unit that was worked on"],
      ),
      "2027-01-31",
    );
    expect(result.action).toEqual({
      input_text: { index: 3, text: "2027-01-31" },
    });
  });

  it("resolves the same intent to a different index when the DOM shifts", () => {
    const shifted = resolveNextAction(
      request(
        "http://localhost:5173/sites/almeria-roof/report",
        `[0]<a >Sites />
[9]<select name=component />`,
      ),
      TODAY,
    );
    expect(shifted.action).toEqual({
      select_dropdown_option: { index: 9, text: "Inverter" },
    });
  });

  it("ticks the follow-up box while it reads as unchecked", () => {
    const result = resolveNextAction(
      request(
        "http://localhost:5173/sites/almeria-roof/report",
        `[6]<input type=checkbox name=follow-up-required checked=false />`,
        [
          "Choose the component",
          "Name the unit that was worked on",
          "Set the work date to today",
          "Record how long it took",
          "Summarise the work",
        ],
      ),
      TODAY,
    );
    expect(result.action).toEqual({ click_element_by_index: { index: 6 } });
  });

  it("fills the follow-up note only once the checkbox revealed it", () => {
    const result = resolveNextAction(
      request(
        "http://localhost:5173/sites/almeria-roof/report",
        `[6]<input type=checkbox name=follow-up-required checked=true />
*[7]<input name=follow-up-note />`,
        [
          "Choose the component",
          "Name the unit that was worked on",
          "Set the work date to today",
          "Record how long it took",
          "Summarise the work",
        ],
      ),
      TODAY,
    );
    expect(result.action).toEqual({
      input_text: { index: 7, text: "Panel 14 still shows a hotspot." },
    });
  });

  it("finishes once the form is submitted and the page moved on", () => {
    const result = resolveNextAction(
      request("http://localhost:5173/reports", `[0]<a >Sites />`, [
        "Submit the report",
      ]),
      TODAY,
    );
    expect(result.action).toMatchObject({ done: { success: true } });
  });

  it("does not claim success merely because it reached the reports list", () => {
    // No submit step in the history: landing here without having filed
    // anything is a failure, not a finished task.
    const result = resolveNextAction(
      request("http://localhost:5173/reports", `[0]<a >Sites />`),
      TODAY,
    );
    expect(result.action).toMatchObject({ done: { success: false } });
  });

  it("does not claim success on a page it does not recognise", () => {
    const result = resolveNextAction(
      request("http://localhost:5173/settings", `[0]<a >Sites />`),
      TODAY,
    );
    expect(result.action).toMatchObject({ done: { success: false } });
  });

  it("fails loudly when it cannot read the current page", () => {
    // A browser_state with no "Current Page:" line must never be mistaken for
    // "every intent is done" — that would report a report that was never filed.
    const result = resolveNextAction(
      [
        { role: "system", content: "sys" },
        {
          role: "user",
          content: "<browser_state>\n[0]<a >Sites />\n</browser_state>",
        },
      ],
      TODAY,
    );
    expect(result.action).toMatchObject({ done: { success: false } });
  });

  it("gives up with a failed done rather than looping forever", () => {
    const result = resolveNextAction(
      request(
        "http://localhost:5173/sites/almeria-roof/report",
        `[0]<a >Nothing here />`,
      ),
      TODAY,
    );
    expect(result.action).toMatchObject({ done: { success: false } });
  });

  it("is a pure function of the request", () => {
    const req = request(
      "http://localhost:5173/sites/almeria-roof/report",
      `[1]<select name=component />`,
    );
    expect(resolveNextAction(req, TODAY).action).toEqual(
      resolveNextAction(req, TODAY).action,
    );
  });
});
