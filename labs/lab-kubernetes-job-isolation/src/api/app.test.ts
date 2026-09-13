import pino from "pino";
import { describe, expect, it } from "vitest";
import { ExecutionError } from "../execution/types.js";
import { createApp } from "./app.js";

const result = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  exitCode: 0,
  output: "hello\n",
};
const logger = pino({ level: "silent" });
const send = (body: string) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
describe("POST /execute", () => {
  it("returns the collected result without altering shell text", async () => {
    const app = createApp(
      {
        execute: async (message) => {
          expect(message).toBe("printf 'hello\\n'");
          return result;
        },
      },
      logger,
    );
    const response = await app.request(
      "/execute",
      send(JSON.stringify({ message: "printf 'hello\\n'" })),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect((await app.request("/execute")).status).toBe(404);
    expect((await app.request("/health")).status).toBe(404);
  });
  it.each([
    "{",
    "{}",
    '{"message":null}',
    '{"message":""}',
    '{"message":"   "}',
    '{"message":7}',
    JSON.stringify({ message: "x".repeat(8192) }),
  ])("rejects invalid or oversized input %s", async (body) => {
    const app = createApp(
      {
        execute: async () => {
          throw new Error("must not execute");
        },
      },
      logger,
    );
    expect((await app.request("/execute", send(body))).status).toBe(400);
  });
  it("caps a chunked body despite a forged Content-Length", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"message":"'));
        controller.enqueue(new Uint8Array(8192).fill(120));
      },
      cancel() {
        cancelled = true;
      },
    });
    const app = createApp({ execute: async () => result }, logger);
    const response = await app.request(
      new Request("http://localhost/execute", {
        method: "POST",
        body,
        headers: { "Content-Length": "1" },
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(400);
    expect(cancelled).toBe(true);
  });
  it("accepts bounded UTF-8 input and counts multibyte bytes", async () => {
    const app = createApp({ execute: async () => result }, logger);
    expect(
      (
        await app.request(
          "/execute",
          send(JSON.stringify({ message: "é".repeat(4090) })),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/execute",
          send(JSON.stringify({ message: "é".repeat(4000) })),
        )
      ).status,
    ).toBe(200);
  });
  it("preserves a nonzero user exit as a completed command", async () => {
    const app = createApp(
      { execute: async () => ({ ...result, exitCode: 7, output: "failed\n" }) },
      logger,
    );
    const response = await app.request(
      "/execute",
      send('{"message":"exit 7"}'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ exitCode: 7 });
  });
  it.each([
    ["timeout", 504, "Execution timed out."],
    ["infrastructure", 500, "Execution failed."],
    ["input", 400, "Invalid request."],
  ] as const)("maps %s to a generic response", async (kind, status, error) => {
    const app = createApp(
      {
        execute: async () => {
          throw new ExecutionError(kind);
        },
      },
      logger,
    );
    const response = await app.request("/execute", send('{"message":"true"}'));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
  it("does not expose an unexpected backend exception", async () => {
    const app = createApp(
      {
        execute: async () => {
          throw new Error("synthetic-private-bytes");
        },
      },
      logger,
    );
    const response = await app.request("/execute", send('{"message":"true"}'));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("synthetic-private-bytes");
  });
});
