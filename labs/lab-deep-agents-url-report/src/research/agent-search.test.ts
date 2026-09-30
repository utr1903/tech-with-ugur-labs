import { expect, it } from "vitest";
import {
  ScriptedModel,
  call,
  finish,
  harness,
  plan,
} from "./agent-test-utils.js";
import { runResearch } from "./agent.js";

it.each([
  {
    instruction: "Search the web page supplied here for the latest updates.",
    allowed: false,
  },
  {
    instruction: "Search the supplied web page for the latest updates.",
    allowed: false,
  },
  {
    instruction: "Use the supplied sources only for current context.",
    allowed: false,
  },
  {
    instruction:
      "Search the provided online reference document for current context.",
    allowed: false,
  },
  {
    instruction: "For latest updates, rely on supplied sources exclusively.",
    allowed: false,
  },
  {
    instruction: "Find additional context inside the supplied sources.",
    allowed: false,
  },
  {
    instruction:
      "Use the supplied web pages only; search the web for current context.",
    allowed: false,
  },
  {
    instruction:
      "Read the supplied pages and search the web for additional current context.",
    allowed: true,
  },
  {
    instruction:
      "Search the supplied page for its main security recommendations.",
    allowed: false,
  },
  {
    instruction:
      "Search only within the supplied URLs for security recommendations",
    allowed: false,
  },
  {
    instruction: "Use only the supplied sources for current context",
    allowed: false,
  },
  {
    instruction: "Search the supplied page for the latest updates",
    allowed: false,
  },
  {
    instruction: "Search the web for additional security recommendations",
    allowed: true,
  },
  { instruction: "Find additional current context", allowed: true },
  { instruction: "Discover external sources about the topic", allowed: true },
])(
  "enforces and exposes search permission for $instruction",
  async ({ instruction, allowed }) => {
    const h = harness(undefined, {}, instruction);
    const model = new ScriptedModel([
      plan(),
      call("read_page", { url: "https://example.com/a" }),
      call("search_web", { query: "external security recommendations" }),
      finish(),
    ]);
    const result = await runResearch(h.request, h.tools, model, h.logger);
    expect(result.exitCode).toBe(0);
    expect(
      h.firecrawl.calls.filter(({ operation }) => operation === "search"),
    ).toHaveLength(allowed ? 1 : 0);
    if (!allowed)
      expect(result.coverage.failures).toContainEqual(
        expect.objectContaining({ reason: "search-not-requested" }),
      );
    const input = JSON.parse(String(model.histories[0]?.at(-1)?.content));
    expect(input.externalSearchAllowed).toBe(allowed);
  },
);
