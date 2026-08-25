import type { Logger } from "../logger.js";

export type InstantSample = {
  metric: Record<string, string>;
  value: [number, string];
};
type RangeSeries = {
  metric: Record<string, string>;
  values: [number, string][];
};
type StoreInfo = { name: string; lastError: string | null };
type QueryOpts = {
  time?: number;
  dedup?: boolean;
  partialResponse?: boolean;
};

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type ApiEnvelope = { status: string; error?: string; data?: unknown };

export class PromClient {
  private readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly fetchFn: FetchLike;

  constructor({
    baseUrl,
    logger,
    fetchFn,
  }: { baseUrl: string; logger: Logger; fetchFn?: FetchLike }) {
    this.baseUrl = baseUrl;
    this.logger = logger.child({ promBaseUrl: baseUrl });
    this.fetchFn = fetchFn ?? (fetch as unknown as FetchLike);
  }

  async instantQuery(
    query: string,
    opts: QueryOpts = {},
  ): Promise<InstantSample[]> {
    const params = this.buildParams({ query }, opts);
    const data = await this.request(`/api/v1/query?${params}`);
    return (data as { result: InstantSample[] }).result;
  }

  async rangeQuery(
    query: string,
    startSec: number,
    endSec: number,
    stepSec: number,
    opts: QueryOpts = {},
  ): Promise<RangeSeries[]> {
    const params = this.buildParams(
      {
        query,
        start: String(startSec),
        end: String(endSec),
        step: String(stepSec),
      },
      opts,
    );
    const data = await this.request(`/api/v1/query_range?${params}`);
    return (data as { result: RangeSeries[] }).result;
  }

  async sidecarStores(): Promise<StoreInfo[]> {
    const data = (await this.request("/api/v1/stores")) as Record<
      string,
      { name: string; lastError: string | null }[]
    >;
    return Object.values(data)
      .flat()
      .map((s) => ({ name: s.name, lastError: s.lastError }));
  }

  private buildParams(
    base: Record<string, string>,
    opts: QueryOpts,
  ): URLSearchParams {
    const params = new URLSearchParams(base);
    if (opts.time !== undefined) params.set("time", String(opts.time));
    if (opts.dedup !== undefined) params.set("dedup", String(opts.dedup));
    if (opts.partialResponse !== undefined)
      params.set("partial_response", String(opts.partialResponse));
    return params;
  }

  private async request(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    this.logger.debug({ url }, "Querying Prometheus API...");
    const res = await this.fetchFn(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      throw new Error(`Prometheus API ${url} returned HTTP ${res.status}`);
    const body = (await res.json()) as ApiEnvelope;
    if (body.status !== "success") {
      throw new Error(
        `Prometheus API ${url} failed: ${body.error ?? "unknown error"}`,
      );
    }
    return body.data;
  }
}
