import type {
  CrawlJob,
  CrawlOptions,
  CrawlResponse,
  Document,
  PaginationConfig,
  ScrapeOptions,
  SearchData,
  SearchRequest,
} from "@mendable/firecrawl-js";
import type { Logger } from "../logger.js";
import type { Ledger, LedgerSnapshot, Source } from "./ledger.js";

interface FirecrawlClient {
  scrape(
    url: string,
    options?: ScrapeOptions & { autoResume?: boolean },
  ): Promise<Document>;
  search(
    query: string,
    options?: Omit<SearchRequest, "query">,
  ): Promise<SearchData>;
  startCrawl(url: string, options?: CrawlOptions): Promise<CrawlResponse>;
  getCrawlStatus(id: string, options?: PaginationConfig): Promise<CrawlJob>;
  cancelCrawl(id: string): Promise<boolean>;
}
interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
export interface ResearchToolOptions {
  firecrawl: FirecrawlClient;
  ledger: Ledger;
  logger: Logger;
  clock: Clock;
  resolveDns?: (host: string) => Promise<string[]>;
}
interface Denial {
  ok: false;
  recoverable: true;
  reason: string;
}
export type ToolResult<T> = ({ ok: true } & T) | Denial;
export interface Candidate {
  url: string;
  title: string;
  description: string;
}
export interface ResearchTools {
  read_page(input: { url: string; referringUrl?: string }): Promise<
    ToolResult<{ source: Source; links: string[] }>
  >;
  search_web(input: { query: string }): Promise<
    ToolResult<{ candidates: Candidate[] }>
  >;
  crawl_site(input: { url: string; limit?: number; depth?: number }): Promise<
    ToolResult<{ sources: Source[] }>
  >;
  snapshot(): LedgerSnapshot;
  record(event: LedgerSnapshot["events"][number]): void;
}
