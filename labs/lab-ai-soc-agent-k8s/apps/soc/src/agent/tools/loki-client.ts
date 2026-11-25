import { z } from "zod";

const TIMEOUT_MS = 15_000;

const ResponseSchema = z.object({
  status: z.string(),
  data: z.object({ resultType: z.string(), result: z.array(z.unknown()) }),
});

export type LokiData = z.infer<typeof ResponseSchema>["data"];

export type LokiClient = {
  queryRange(
    query: string,
    startNs: bigint,
    endNs: bigint,
    limit: number,
  ): Promise<LokiData>;
  instant(query: string, timeNs: bigint): Promise<LokiData>;
};

export function createLokiClient(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): LokiClient {
  async function get(
    path: string,
    params: Record<string, string>,
  ): Promise<LokiData> {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetchFn(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(`Loki returned ${res.status}: ${text}`);
    }
    return ResponseSchema.parse(await res.json()).data;
  }

  return {
    queryRange: (query, startNs, endNs, limit) =>
      get("/loki/api/v1/query_range", {
        query,
        start: startNs.toString(),
        end: endNs.toString(),
        limit: String(limit),
        direction: "backward",
      }),
    instant: (query, timeNs) =>
      get("/loki/api/v1/query", { query, time: timeNs.toString() }),
  };
}
