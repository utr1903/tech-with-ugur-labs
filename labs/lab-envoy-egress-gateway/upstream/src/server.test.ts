import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";
import { createServer } from "./server.js";

const logger = createLogger({ appName: "upstream-test" });
let close: (() => Promise<void>) | undefined;

async function listen(payloadBytes: number): Promise<string> {
  const server = createServer(
    { port: 0, payloadBytes, destinationName: "api.payments.example.com" },
    logger,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await close?.();
  close = undefined;
});

describe("createServer", () => {
  it("answers /health with ok", async () => {
    const base = await listen(64);
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("answers any other path with exactly PAYLOAD_BYTES bytes", async () => {
    const base = await listen(2048);
    const res = await fetch(`${base}/orders`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("2048");
    expect((await res.arrayBuffer()).byteLength).toBe(2048);
  });
});
