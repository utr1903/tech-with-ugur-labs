import { describe, expect, it } from "vitest";
import { agentOutput } from "./envelope.js";

describe("agentOutput", () => {
  it("builds a chat completion the library will accept", () => {
    const body = agentOutput("gemini-3.8-flash", "click the site", {
      click_element_by_index: { index: 4 },
    }) as {
      model: string;
      choices: {
        finish_reason: string;
        message: {
          tool_calls: { function: { name: string; arguments: string } }[];
        };
      }[];
    };

    expect(body.model).toBe("gemini-3.8-flash");
    const choice = body.choices[0]!;
    expect(choice.finish_reason).toBe("tool_calls");
    const call = choice.message.tool_calls[0]!;
    expect(call.function.name).toBe("AgentOutput");
    expect(JSON.parse(call.function.arguments)).toEqual({
      next_goal: "click the site",
      action: { click_element_by_index: { index: 4 } },
    });
  });
});
