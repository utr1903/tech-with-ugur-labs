import type { AddressInfo } from "node:net";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { attemptDirectByIp, attemptDirectByName } from "./bypass.js";

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function startListener(): Promise<number> {
  const server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stop = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return (server.address() as AddressInfo).port;
}

describe("attemptDirectByIp", () => {
  it("reports a reachable destination as NOT blocked", async () => {
    const port = await startListener();
    expect(
      await attemptDirectByIp({ ip: "127.0.0.1", port, timeoutMs: 2000 }),
    ).toEqual({
      blocked: false,
      stage: "connect",
      code: "CONNECTED",
    });
  });

  it("reports a refused connection as blocked at the connect stage", async () => {
    const outcome = await attemptDirectByIp({
      ip: "127.0.0.1",
      port: 1,
      timeoutMs: 2000,
    });
    expect(outcome).toEqual({
      blocked: true,
      stage: "connect",
      code: "ECONNREFUSED",
    });
  });
});

describe("attemptDirectByName", () => {
  it("reports a name that will not resolve as blocked at the dns stage", async () => {
    const outcome = await attemptDirectByName({
      host: "payments-direct.example.com",
      port: 8080,
      timeoutMs: 500,
      resolve4: async () => {
        const err: NodeJS.ErrnoException = new Error("queryA ESERVFAIL");
        err.code = "ESERVFAIL";
        throw err;
      },
    });
    expect(outcome).toEqual({ blocked: true, stage: "dns", code: "ESERVFAIL" });
  });

  it("falls through to a connection attempt when the name does resolve", async () => {
    const port = await startListener();
    const outcome = await attemptDirectByName({
      host: "payments-direct.example.com",
      port,
      timeoutMs: 2000,
      resolve4: async () => ["127.0.0.1"],
    });
    expect(outcome).toEqual({
      blocked: false,
      stage: "connect",
      code: "CONNECTED",
    });
  });
});
