import { AIMessage } from "@langchain/core/messages";
import { expect, it } from "vitest";
import {
  ScriptedModel,
  call,
  draft,
  finish,
  harness,
  plan,
} from "./agent-test-utils.js";
import { runResearch } from "./agent.js";

it("resumes the same state with feedback and requires a revised plan before corrected evidence", async () => {
  const h = harness(["https://example.com/a", "https://example.com/b"]);
  const model = new ScriptedModel([
    plan(),
    call("read_page", { url: "https://example.com/a" }),
    finish(),
    call("read_page", { url: "https://example.com/b" }),
    plan(),
    call("read_page", { url: "https://example.com/b" }),
    finish(
      draft({
        articles: [
          { sourceId: "S1", summary: "A" },
          { sourceId: "S2", summary: "B" },
        ],
        selectedUrls: [
          { url: "https://example.com/a", reason: "Supplied A" },
          { url: "https://example.com/b", reason: "Supplied B" },
        ],
      }),
    ),
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode, JSON.stringify(result.coverage)).toBe(0);
  expect(result.coverage.planMilestones).toHaveLength(2);
  const resumed = model.histories[3] ?? [];
  expect(
    resumed.some(
      (message) =>
        message.type === "tool" && String(message.content).includes("Evidence"),
    ),
  ).toBe(true);
  expect(
    resumed.some(
      (message) =>
        message.type === "human" &&
        String(message.content).includes("missingRequestedAttempts"),
    ),
  ).toBe(true);
  expect(result.coverage.failures).toContainEqual(
    expect.objectContaining({ reason: "plan-required" }),
  );
});
it("stops after two feedback rounds and excludes unsupported citations", async () => {
  const h = harness();
  const invalid = finish(
    draft({ articles: [{ sourceId: "invented", summary: "Unsupported" }] }),
  );
  const model = new ScriptedModel([
    plan(),
    call("read_page", { url: "https://example.com/a" }),
    invalid,
    plan(),
    invalid,
    plan(),
    invalid,
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode).toBe(1);
  expect(result.report).not.toContain("Unsupported");
  expect(
    model.histories.filter((messages) => messages.at(-1)?.type === "human"),
  ).toHaveLength(3);
});
it("ends cap exhaustion with partial coverage without requesting another draft", async () => {
  const h = harness(undefined, { maxReads: 1 });
  const model = new ScriptedModel([
    plan(),
    call("read_page", { url: "https://example.com/a" }),
    finish(
      draft({ articles: [{ sourceId: "missing", summary: "No evidence" }] }),
    ),
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode).toBe(1);
  expect(model.histories).toHaveLength(3);
});
it("attempts excess input URLs and reports the cap instead of claiming completeness", async () => {
  const urls = ["https://example.com/a", "https://example.com/b"];
  const h = harness(urls, { maxReads: 1 });
  const model = new ScriptedModel([
    plan(),
    ...urls.map((url) => call("read_page", { url })),
    finish(),
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode).toBe(1);
  expect(result.coverage.requestedUrls.map(({ outcome }) => outcome)).toEqual([
    "read",
    "capped",
  ]);
});
it("feeds back a missing structured draft and repairs it on the same thread", async () => {
  const h = harness();
  const model = new ScriptedModel([
    plan(),
    call("read_page", { url: "https://example.com/a" }),
    new AIMessage("Unstructured draft"),
    plan(),
    finish(),
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode, JSON.stringify(result.coverage)).toBe(0);
  expect(result.coverage.planMilestones).toHaveLength(2);
  expect(
    (model.histories[3] ?? []).some(
      (message) =>
        message.type === "human" &&
        String(message.content).includes("schemaErrors"),
    ),
  ).toBe(true);
});
