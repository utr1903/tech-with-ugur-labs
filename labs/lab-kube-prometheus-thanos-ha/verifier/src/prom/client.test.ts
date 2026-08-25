import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { type FetchLike, PromClient } from "./client.js";

const logger = pino({ level: "silent" });

function stubFetch(
  payload: unknown,
  status = 200,
): { fetchFn: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchFn: FetchLike = async (url) => {
    urls.push(String(url));
    return { ok: status < 400, status, json: async () => payload };
  };
  return { fetchFn, urls };
}

describe("PromClient.instantQuery", () => {
  it("returns the result vector and encodes query options", async () => {
    const { fetchFn, urls } = stubFetch({
      status: "success",
      data: {
        resultType: "vector",
        result: [{ metric: { job: "x" }, value: [1700000000, "3"] }],
      },
    });
    const client = new PromClient({
      baseUrl: "http://prom:9090",
      logger,
      fetchFn,
    });
    const result = await client.instantQuery("count(up)", {
      time: 1700000000,
      dedup: false,
      partialResponse: false,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.value[1]).toBe("3");
    expect(urls[0]).toContain("/api/v1/query?");
    expect(urls[0]).toContain("query=count%28up%29");
    expect(urls[0]).toContain("time=1700000000");
    expect(urls[0]).toContain("dedup=false");
    expect(urls[0]).toContain("partial_response=false");
  });

  it("throws on HTTP errors", async () => {
    const { fetchFn } = stubFetch({}, 500);
    const client = new PromClient({
      baseUrl: "http://prom:9090",
      logger,
      fetchFn,
    });
    await expect(client.instantQuery("up")).rejects.toThrow(/HTTP 500/);
  });

  it("throws when the API reports failure", async () => {
    const { fetchFn } = stubFetch({ status: "error", error: "bad query" });
    const client = new PromClient({
      baseUrl: "http://prom:9090",
      logger,
      fetchFn,
    });
    await expect(client.instantQuery("up")).rejects.toThrow(/bad query/);
  });
});

describe("PromClient.rangeQuery", () => {
  it("returns range series with start/end/step encoded", async () => {
    const { fetchFn, urls } = stubFetch({
      status: "success",
      data: {
        resultType: "matrix",
        result: [
          {
            metric: {},
            values: [
              [1700000000, "3"],
              [1700000015, "3"],
            ],
          },
        ],
      },
    });
    const client = new PromClient({
      baseUrl: "http://prom:9090",
      logger,
      fetchFn,
    });
    const result = await client.rangeQuery(
      "sum(up)",
      1700000000,
      1700000060,
      15,
    );
    expect(result[0]?.values).toHaveLength(2);
    expect(urls[0]).toContain("/api/v1/query_range?");
    expect(urls[0]).toContain("start=1700000000");
    expect(urls[0]).toContain("end=1700000060");
    expect(urls[0]).toContain("step=15");
  });
});

describe("PromClient.sidecarStores", () => {
  it("flattens every store group into name + lastError entries", async () => {
    const { fetchFn } = stubFetch({
      status: "success",
      data: {
        sidecar: [
          { name: "10.0.0.1:10901", lastError: null },
          { name: "10.0.0.2:10901", lastError: "rpc error" },
        ],
      },
    });
    const client = new PromClient({
      baseUrl: "http://thanos:9090",
      logger,
      fetchFn,
    });
    const stores = await client.sidecarStores();
    expect(stores).toEqual([
      { name: "10.0.0.1:10901", lastError: null },
      { name: "10.0.0.2:10901", lastError: "rpc error" },
    ]);
  });
});
