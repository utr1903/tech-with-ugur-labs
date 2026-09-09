import { describe, expect, it } from "vitest";
import { didGoal, findByAttr, findByText, parseAgentView } from "./prompt.js";

const userContent = `<agent_state>
<user_request>
replaced the string 3 inverter fan on the Almeria roof array this morning
</user_request>
<step_info>
Step 3 of 20 max possible steps
Current time: 9/9/2026, 10:12:00 AM
</step_info>
</agent_state>

<agent_history>
<step_1>
Evaluation of Previous Step: ok
Memory: nothing yet
Next Goal: Open the Almeria Roof Array site
Action Results: ✅ Clicked element (Almeria Roof Array).
</step_1>
<step_2>
Evaluation of Previous Step: ok
Memory: on the site page
Next Goal: Choose the component
Action Results: ❌ Failed to select option: Error: Option not found
</step_2>
</agent_history>

<browser_state>
Current Page: [Solar Logbook](http://localhost:5173/sites/almeria-roof/report)
Page info: 1280x720px viewport, 1280x900px total page size

Interactive elements from top layer of the current page (full page):

[Start of page]
File a report
Almeria Roof Array
[0]<label for=component>Component />
[1]<select name=component>Choose a component
Inverter
Panel string />
[2]<input type=text name=component-ref />
*[3]<input type=checkbox checked=false name=follow-up-required />
[4]<button type=submit name=submit-report>Submit report />
[End of page]

</browser_state>`;

const messages = [
  { role: "system", content: "system prompt" },
  { role: "user", content: userContent },
];

describe("parseAgentView", () => {
  it("reads the current url", () => {
    expect(parseAgentView(messages).url).toBe(
      "http://localhost:5173/sites/almeria-roof/report",
    );
  });

  it("reads the task", () => {
    expect(parseAgentView(messages).task).toContain("string 3 inverter fan");
  });

  it("counts the steps already taken", () => {
    expect(parseAgentView(messages).stepCount).toBe(2);
  });

  it("parses every indexed element", () => {
    expect(parseAgentView(messages).elements.map((e) => e.index)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("parses attributes and text", () => {
    const view = parseAgentView(messages);
    const select = view.elements.find((e) => e.index === 1);
    expect(select?.tag).toBe("select");
    expect(select?.attrs.name).toBe("component");
    expect(select?.text).toContain("Panel string");
  });

  it("parses an element whose text spans several lines", () => {
    // A <select>'s text is its option list, so its record is always
    // multi-line. A per-line scan drops exactly this element, and it is the
    // one the component intent needs — this test is that regression's guard.
    const select = findByAttr(parseAgentView(messages), "name", "component");
    expect(select?.index).toBe(1);
    expect(select?.text.split("\n")).toEqual([
      "Choose a component",
      "Inverter",
      "Panel string",
    ]);
  });

  it("does not confuse a label with the control it labels", () => {
    // Labels are interactive and indexed too; matching on `name` skips them.
    const view = parseAgentView(messages);
    expect(view.elements.find((e) => e.index === 0)?.tag).toBe("label");
    expect(findByAttr(view, "name", "component")?.tag).toBe("select");
  });

  it("marks a newly appeared element", () => {
    const view = parseAgentView(messages);
    expect(view.elements.find((e) => e.index === 3)?.isNew).toBe(true);
    expect(view.elements.find((e) => e.index === 4)?.isNew).toBe(false);
  });

  it("finds an element by attribute", () => {
    const view = parseAgentView(messages);
    expect(findByAttr(view, "name", "component-ref")?.index).toBe(2);
  });

  it("matches an attribute value the library truncated at 20 characters", () => {
    const view = parseAgentView([
      messages[0]!,
      {
        role: "user",
        content: `<browser_state>
Current Page: [x](http://localhost:5173/)
[7]<input name=follow-up-note-fi... />
</browser_state>`,
      },
    ]);
    expect(findByAttr(view, "name", "follow-up-note-field")?.index).toBe(7);
  });

  it("finds an element by its text", () => {
    expect(findByText(parseAgentView(messages), "submit report")?.index).toBe(
      4,
    );
  });

  it("parses each history step's goal and result", () => {
    const { history } = parseAgentView(messages);
    expect(history).toHaveLength(2);
    expect(history[0]?.goal).toBe("Open the Almeria Roof Array site");
    expect(history[0]?.result.startsWith("✅")).toBe(true);
  });

  it("counts a goal as done only when its action succeeded", () => {
    const view = parseAgentView(messages);
    expect(didGoal(view, "Open the Almeria Roof Array site")).toBe(true);
    // step 2 ran but the action failed, so the goal must be retried
    expect(didGoal(view, "Choose the component")).toBe(false);
    expect(didGoal(view, "Never attempted")).toBe(false);
  });

  it("throws when there is no user message", () => {
    expect(() => parseAgentView([{ role: "system", content: "x" }])).toThrow(
      /user message/,
    );
  });
});
