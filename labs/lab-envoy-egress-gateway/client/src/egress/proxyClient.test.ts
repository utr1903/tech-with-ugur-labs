import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { requestViaProxy } from "./proxyClient.js";

let stop: (() => Promise<void>) | undefined;

// A stand-in for the gateway: it records what the client actually put on the
// wire, which is how we prove the client speaks forward-proxy (absolute-form
// request target) rather than sending an origin-form request.
async function startFakeProxy(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stop = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

describe("requestViaProxy", () => {
  it("sends the absolute-form request target and the target host header", async () => {
    let seenPath: string | undefined;
    let seenHost: string | undefined;
    const port = await startFakeProxy((req, res) => {
      seenPath = req.url;
      seenHost = req.headers.host;
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end("xxxx");
    });

    const result = await requestViaProxy({
      proxyHost: "127.0.0.1",
      proxyPort: port,
      url: "http://api.payments.example.com/orders",
      timeoutMs: 2000,
    });

    expect(seenPath).toBe("http://api.payments.example.com/orders");
    expect(seenHost).toBe("api.payments.example.com");
    expect(result).toEqual({
      ok: true,
      status: 200,
      bytes: 4,
      bodyPreview: "xxxx",
    });
  });

  it("returns the status and body of a denial rather than throwing", async () => {
    const port = await startFakeProxy((_req, res) => {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("egress denied: destination not in allow-list\n");
    });

    const result = await requestViaProxy({
      proxyHost: "127.0.0.1",
      proxyPort: port,
      url: "http://exfil.shadow-analytics.example.com/collect",
      timeoutMs: 2000,
    });

    expect(result).toMatchObject({ ok: true, status: 403 });
    expect(result).toHaveProperty(
      "bodyPreview",
      expect.stringContaining("egress denied"),
    );
  });
});

describe("requestViaProxy when the exchange breaks", () => {
  it("reports a body that stops mid-stream as a failure", async () => {
    // The write callback fires once the bytes are on the wire, so the client has
    // its headers and a partial body before the connection is torn out from
    // under it: the failure arrives on the response stream, not the request.
    const port = await startFakeProxy((_req, res) => {
      res.writeHead(200, { "content-length": "1024" });
      res.write("xxxx", () => res.socket?.destroy());
    });

    const result = await requestViaProxy({
      proxyHost: "127.0.0.1",
      proxyPort: port,
      url: "http://assets.cdn.example.com/bundle.js",
      timeoutMs: 2000,
    });

    expect(result).toMatchObject({ ok: false });
  });

  it("reports an unreachable proxy as a failure with its error code", async () => {
    const result = await requestViaProxy({
      proxyHost: "127.0.0.1",
      proxyPort: 1,
      url: "http://api.payments.example.com/orders",
      timeoutMs: 2000,
    });
    expect(result).toEqual({ ok: false, error: "ECONNREFUSED" });
  });
});
