import { AIMessage } from "@langchain/core/messages";
import { pino } from "pino";
import { expect, it } from "vitest";
import {
  ScriptedModel,
  call,
  finish,
  harness,
  plan,
} from "./agent-test-utils.js";
import { runResearch } from "./agent.js";

it("requires a valid nonempty plan before trusting its web-call permission", async () => {
  const h = harness();
  const model = new ScriptedModel([
    call("write_todos", {
      todos: [{ content: "invalid", status: "invented" }],
    }),
    call("read_page", { url: "https://example.com/a" }),
    plan(),
    call("read_page", { url: "https://example.com/a" }),
    finish(),
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode).toBe(0);
  expect(result.coverage.planMilestones).toHaveLength(1);
  expect(result.coverage.failures).toContainEqual(
    expect.objectContaining({ reason: "plan-required" }),
  );
});
it("does not grant same-turn web calls permission from a parallel plan", async () => {
  const h = harness();
  const combined = new AIMessage({
    content: "",
    tool_calls: [
      ...(plan().tool_calls ?? []),
      ...(call("read_page", { url: "https://example.com/a" }).tool_calls ?? []),
    ],
  });
  const result = await runResearch(
    h.request,
    h.tools,
    new ScriptedModel([
      combined,
      call("read_page", { url: "https://example.com/a" }),
      finish(),
    ]),
    h.logger,
  );
  expect(result.exitCode).toBe(0);
  expect(h.order).toHaveLength(1);
  expect(result.coverage.failures).toContainEqual(
    expect.objectContaining({ reason: "plan-required" }),
  );
});
it("returns partial coverage when the model exceeds the total time budget", async () => {
  const h = harness(undefined, { maxDurationMs: 30 });
  class HangingModel extends ScriptedModel {
    async _generate(): Promise<never> {
      return new Promise(() => {});
    }
  }
  const result = await runResearch(
    h.request,
    h.tools,
    new HangingModel([]),
    h.logger,
  );
  expect(result.exitCode).toBe(1);
  expect(result.coverage.limitsReached).toContainEqual(
    expect.objectContaining({ reason: "time-budget" }),
  );
  expect(h.order).toEqual([]);
});
it("contains model provider failures without logging credentials or prompt content", async () => {
  const h = harness();
  const logs: string[] = [];
  const logger = pino(
    {},
    {
      write: (line) => {
        logs.push(line);
      },
    },
  );
  const model = new ScriptedModel([
    () => {
      throw new Error("sk-secret model request payload");
    },
  ]);
  const result = await runResearch(h.request, h.tools, model, logger);
  expect(result.exitCode).toBe(1);
  expect(result.coverage.failures).toContainEqual(
    expect.objectContaining({ reason: "agent-provider-error" }),
  );
  expect(logs.join()).not.toMatch(/sk-secret|request payload/);
});
it.each([
  "Compare the supplied pages",
  "Explain the context of the supplied page",
  "Read https://example.com/search",
  "Find the main points in the supplied pages",
  "Do not search; summarize the supplied page",
])(
  "does not infer external discovery permission from %s",
  async (instruction) => {
    const h = harness(undefined, {}, instruction);
    const result = await runResearch(
      h.request,
      h.tools,
      new ScriptedModel([
        plan(),
        call("read_page", { url: "https://example.com/a" }),
        call("search_web", { query: "external context" }),
        finish(),
      ]),
      h.logger,
    );
    expect(result.exitCode).toBe(0);
    expect(
      h.firecrawl.calls.filter(({ operation }) => operation === "search"),
    ).toEqual([]);
    expect(result.coverage.failures).toContainEqual(
      expect.objectContaining({ reason: "search-not-requested" }),
    );
  },
);
