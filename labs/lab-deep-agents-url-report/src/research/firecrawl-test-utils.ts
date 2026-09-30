import type {
  CrawlJob,
  CrawlOptions,
  Document,
  ScrapeOptions,
  SearchData,
} from "@mendable/firecrawl-js";
import { pino } from "pino";
import { createResearchTools } from "./firecrawl-tools.js";
import { type Limits, createLedger } from "./ledger.js";

export const document = (url: string, markdown = "Evidence"): Document => ({
  markdown,
  metadata: { sourceURL: url, url, title: "Article", statusCode: 200 },
  links: [],
});
class FakeFirecrawl {
  calls: { operation: string; input: unknown; options?: unknown }[] = [];
  page = document("https://example.com/a");
  results: SearchData = { web: [] };
  jobs: CrawlJob[] = [
    {
      id: "job-1",
      status: "completed",
      total: 1,
      completed: 1,
      data: [document("https://example.com/a")],
    },
  ];
  error: unknown;
  async scrape(url: string, options?: ScrapeOptions): Promise<Document> {
    this.calls.push({ operation: "scrape", input: url, options });
    if (this.error) throw this.error;
    return this.page;
  }
  async search(query: string, options?: unknown): Promise<SearchData> {
    this.calls.push({ operation: "search", input: query, options });
    if (this.error) throw this.error;
    return this.results;
  }
  async startCrawl(url: string, options?: CrawlOptions) {
    this.calls.push({ operation: "startCrawl", input: url, options });
    if (this.error) throw this.error;
    return { id: "job-1", url: "https://api.firecrawl.dev/v2/crawl/job-1" };
  }
  async getCrawlStatus(id: string, options?: unknown): Promise<CrawlJob> {
    this.calls.push({ operation: "getCrawlStatus", input: id, options });
    if (this.error) throw this.error;
    const job = this.jobs.shift();
    if (!job) throw new Error("Unexpected poll");
    return job;
  }
  async cancelCrawl(id: string) {
    this.calls.push({ operation: "cancelCrawl", input: id });
    return true;
  }
}
export function setup(limits: Partial<Limits> = {}) {
  const firecrawl = new FakeFirecrawl();
  const ledger = createLedger(
    { instruction: "Research", requestedUrls: [], invalidEntries: [] },
    limits,
  );
  let time = 0;
  const dnsHosts: string[] = [];
  let answers = ["93.184.216.34"];
  const logs: string[] = [];
  const tools = createResearchTools({
    firecrawl,
    ledger,
    logger: pino(
      { level: "info" },
      {
        write: (line) => {
          logs.push(line);
        },
      },
    ),
    clock: {
      now: () => time,
      sleep: async (ms: number) => {
        time += ms;
      },
    },
    resolveDns: async (host: string) => {
      dnsHosts.push(host);
      return answers;
    },
  });
  return {
    firecrawl,
    ledger,
    tools,
    dnsHosts,
    logs,
    setTime: (value: number) => {
      time = value;
    },
    setAnswers: (value: string[]) => {
      answers = value;
    },
  };
}
