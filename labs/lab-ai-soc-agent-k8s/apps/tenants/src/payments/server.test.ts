import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaymentsServer } from "./server.js";

const logger = { info: vi.fn(), error: vi.fn() } as never;
const row = {
  id: 7,
  name: "Ada Test",
  card_last4: "0007",
  card_number: "x",
  email: "y",
};
const pool = { query: async () => ({ rows: [row] }) } as never;

let closer: (() => void) | undefined;
afterEach(() => closer?.());

async function start(p: never): Promise<string> {
  const server = createPaymentsServer(logger, p);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  closer = () => server.close();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("payments server", () => {
  it("returns only id, name and card_last4", async () => {
    const base = await start(pool);
    const res = await fetch(`${base}/customers/7`);
    expect(await res.json()).toEqual({
      id: 7,
      name: "Ada Test",
      card_last4: "0007",
    });
  });

  it("returns 404 for an unknown customer", async () => {
    const base = await start({ query: async () => ({ rows: [] }) } as never);
    expect((await fetch(`${base}/customers/9`)).status).toBe(404);
  });

  it("answers the health check", async () => {
    const base = await start(pool);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});
