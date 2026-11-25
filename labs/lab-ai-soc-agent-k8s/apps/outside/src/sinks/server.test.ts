import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { createSinkServer } from "./server.js";

const logger = createLogger({ appName: "test" });
const servers: ReturnType<typeof createSinkServer>[] = [];

async function start(): Promise<string> {
  const server = createSinkServer(logger, {
    scenariosDir: "/nonexistent",
    attackerIp: "10.0.0.5",
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("sink server", () => {
  it("records an upload with its byte count and sha256", async () => {
    const base = await start();
    const res = await fetch(`${base}/upload`, {
      method: "POST",
      body: "hello",
    });
    expect(res.status).toBe(200);
    const hits = (await (await fetch(`${base}/hits`)).json()) as Record<
      string,
      unknown
    >[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ event: "exfil", bytes: 5 });
    expect(hits[0]?.sha256).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("records beacons and filters hits by since", async () => {
    const base = await start();
    await fetch(`${base}/beacon?id=abc`);
    const all = (await (await fetch(`${base}/hits`)).json()) as {
      event: string;
      id: string;
      ts: number;
    }[];
    expect(all[0]).toMatchObject({ event: "beacon", id: "abc" });
    const later = await (
      await fetch(`${base}/hits?since=${(all[0]?.ts ?? 0) + 1}`)
    ).json();
    expect(later).toEqual([]);
  });

  it("returns 404 for unknown stage scenarios", async () => {
    const base = await start();
    expect((await fetch(`${base}/stage/s9-nope`)).status).toBe(404);
  });
});
