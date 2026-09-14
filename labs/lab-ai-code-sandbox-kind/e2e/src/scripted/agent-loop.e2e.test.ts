import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CAFE_PROBLEM,
  EXPECTED_PRICES,
  SECTION_HEADINGS,
} from "../support/cafe.js";
import { sendChat } from "../support/chat-client.js";
import {
  assistantText,
  toolInputs,
  toolOutputs,
} from "../support/ui-stream.js";

describe("agent loop", () => {
  it("calls code_executor, gets the prices back and answers from them", async () => {
    const chunks = await sendChat(randomUUID(), CAFE_PROBLEM);

    const calls = toolInputs(chunks);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.toolName).toBe("code_executor");
    expect(String(calls[0]?.input.code)).toContain("np.linalg.solve");

    const outputs = toolOutputs(chunks);
    expect(outputs.map((o) => o.toolCallId)).toEqual(
      calls.map((c) => c.toolCallId),
    );
    const run = outputs[0]?.output as {
      status: string;
      result: { solution: Record<string, number> };
    };
    expect(run.status).toBe("succeeded");
    for (const [item, price] of Object.entries(EXPECTED_PRICES)) {
      expect(run.result.solution[item]).toBeCloseTo(price, 6);
    }

    const text = assistantText(chunks);
    const positions = SECTION_HEADINGS.map((h) => text.indexOf(`### ${h}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const [item, price] of Object.entries(EXPECTED_PRICES)) {
      expect(text).toContain(`| ${item} | ${price} |`);
    }
  });
});
