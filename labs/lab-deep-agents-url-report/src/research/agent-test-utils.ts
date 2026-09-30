import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Document } from "@mendable/firecrawl-js";
import { pino } from "pino";
import { document, setup } from "./firecrawl-test-utils.js";
import { createResearchTools } from "./firecrawl-tools.js";
import type { ResearchRequest } from "./input.js";
import { type Limits, createLedger } from "./ledger.js";
import type { ReportDraft } from "./report.js";

type Step = AIMessage | ((messages: BaseMessage[]) => AIMessage);
export class ScriptedModel extends BaseChatModel {
  histories: BaseMessage[][] = [];
  visibleTools: string[][] = [];
  constructor(private readonly steps: Step[]) {
    super({});
  }
  _llmType() {
    return "scripted";
  }
  bindTools(tools: StructuredToolInterface[]) {
    this.visibleTools.push(
      tools.map((tool) =>
        "function" in tool
          ? (tool.function as { name: string }).name
          : tool.name,
      ),
    );
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.histories.push(messages);
    const step = this.steps.shift();
    if (!step) throw new Error("Script exhausted");
    const message = typeof step === "function" ? step(messages) : step;
    return { generations: [{ text: "", message }] };
  }
}
export const call = (name: string, args: Record<string, unknown>) =>
  new AIMessage({
    content: "",
    tool_calls: [{ name, args, id: crypto.randomUUID() }],
  });
export const plan = () =>
  call("write_todos", {
    todos: [
      {
        content: "Read supplied URLs and select relevant evidence",
        status: "in_progress",
      },
      { content: "Validate and write cited report", status: "pending" },
    ],
  });
export const draft = (overrides: Partial<ReportDraft> = {}): ReportDraft => ({
  articles: [{ sourceId: "S1", summary: "Page evidence." }],
  themes: [],
  selectedUrls: [
    { url: "https://example.com/a", reason: "Reader supplied page" },
  ],
  listingSourceIds: [],
  knownOmissions: [],
  coverageNarrative: "Supplied pages read.",
  ...overrides,
});
export const finish = (value = draft()) => call("report_draft", value);
export function harness(
  urls = ["https://example.com/a"],
  limits: Partial<Limits> = {},
  instruction = "Research supplied URLs",
) {
  const request: ResearchRequest = {
    instruction,
    requestedUrls: urls.map((url) => ({
      url,
      host: new URL(url).hostname,
      origins: [{ kind: "instruction" }],
    })),
    invalidEntries: [],
  };
  const ledger = createLedger(request, limits);
  const { firecrawl } = setup();
  const pages = new Map<string, Document>();
  const order: string[] = [];
  firecrawl.scrape = async (url) => {
    order.push(`scrape:${url}`);
    if (!ledger.snapshot().events.some((event) => event.kind === "plan"))
      throw new Error("A web call preceded the plan");
    return pages.get(url) ?? document(url);
  };
  const logger = pino({ level: "silent" });
  const tools = createResearchTools({
    firecrawl,
    ledger,
    logger,
    clock: { now: () => Date.now(), sleep: async () => {} },
    resolveDns: async () => ["93.184.216.34"],
  });
  return { request, tools, logger, ledger, firecrawl, pages, order };
}
