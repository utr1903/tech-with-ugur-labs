import { AIMessage } from "@langchain/core/messages";
import { expect, it, vi } from "vitest";
import {
  ScriptedModel,
  call,
  finish,
  harness,
  plan,
} from "./agent-test-utils.js";
import { runResearch } from "./agent.js";

it("repairs malformed report tool arguments through schema feedback on the same thread", async () => {
  const h = harness();
  const model = new ScriptedModel([
    plan(),
    call("read_page", { url: "https://example.com/a" }),
    call("report_draft", { articles: [] }),
    plan(),
    finish(),
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode, JSON.stringify(result.coverage)).toBe(0);
  expect(result.coverage.planMilestones).toHaveLength(2);
  expect(result.coverage.sources).toHaveLength(1);
  expect(result.coverage.failures).not.toContainEqual(
    expect.objectContaining({ reason: "agent-provider-error" }),
  );
  const resumed = model.histories[3] ?? [];
  expect(
    resumed.some(
      (message) =>
        message.type === "tool" && String(message.content).includes("Evidence"),
    ),
  ).toBe(true);
  const feedback = String(resumed.at(-1)?.content);
  expect(feedback).toContain("schemaErrors");
  expect(feedback).toContain("themes");
  expect(result.report).toContain("[S1](https://example.com/a)");
});
it("bounds malformed-tool repair to two application feedback rounds", async () => {
  const h = harness();
  const invalid = () => call("report_draft", { articles: [] });
  const model = new ScriptedModel([
    plan(),
    call("read_page", { url: "https://example.com/a" }),
    invalid(),
    plan(),
    invalid(),
    plan(),
    invalid(),
    plan(),
    finish(),
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode).toBe(1);
  expect(model.histories).toHaveLength(7);
  expect(result.coverage.planMilestones).toHaveLength(3);
  expect(result.coverage.reasons).toContain("The structured draft is invalid.");
  expect(result.coverage.failures).not.toContainEqual(
    expect.objectContaining({ reason: "agent-provider-error" }),
  );
});
it("keeps the original deadline across malformed-tool repair", async () => {
  vi.useFakeTimers();
  try {
    const h = harness(undefined, { maxDurationMs: 100 });
    class SlowModel extends ScriptedModel {
      async _generate(messages: Parameters<ScriptedModel["_generate"]>[0]) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return super._generate(messages);
      }
    }
    const model = new SlowModel([
      plan(),
      call("read_page", { url: "https://example.com/a" }),
      call("report_draft", { articles: [] }),
      plan(),
      finish(),
    ]);
    const work = runResearch(h.request, h.tools, model, h.logger);
    await vi.advanceTimersByTimeAsync(101);
    const result = await work;
    expect(result.exitCode).toBe(1);
    expect(result.coverage.limitsReached).toContainEqual(
      expect.objectContaining({ reason: "time-budget" }),
    );
    expect(result.coverage.planMilestones).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});
it("repairs multiple structured outputs without classifying them as provider failure", async () => {
  const h = harness();
  const multiple = new AIMessage({
    content: "",
    tool_calls: [
      ...(finish().tool_calls ?? []),
      ...(finish().tool_calls ?? []),
    ],
  });
  const model = new ScriptedModel([
    plan(),
    call("read_page", { url: "https://example.com/a" }),
    multiple,
    plan(),
    finish(),
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode).toBe(0);
  expect(result.coverage.failures).toEqual([]);
  expect(String(model.histories[3]?.at(-1)?.content)).toContain(
    "multiple_structured_outputs",
  );
});
