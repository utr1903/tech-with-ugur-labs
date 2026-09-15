import pino from "pino";
import { describe, expect, it } from "vitest";
import { createServerApp } from "./app.js";

const logger = pino({ enabled: false });

function post(body: string): RequestInit {
  return {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  };
}

describe("publisher HTTP application", () => {
  it("reports health without publishing", async () => {
    const published: number[] = [];
    const app = createServerApp({
      publish: async (number) => {
        published.push(number);
        return "unused";
      },
      logger,
    });

    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(published).toEqual([]);
  });

  it("publishes a finite number and returns its message ID", async () => {
    const published: number[] = [];
    const app = createServerApp({
      publish: async (number) => {
        published.push(number);
        return "message-123";
      },
      logger,
    });

    const response = await app.request("/", post('{"number":101}'));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      messageId: "message-123",
    });
    expect(published).toEqual([101]);
  });

  it("waits for Pub/Sub to accept the message before responding", async () => {
    let accept: (messageId: string) => void = () => {
      throw new Error("acceptance resolver was not installed");
    };
    const acceptance = new Promise<string>((resolve) => {
      accept = resolve;
    });
    const app = createServerApp({ publish: async () => acceptance, logger });
    let responded = false;

    const pendingResponse = app
      .request("/", post('{"number":101}'))
      .then((response) => {
        responded = true;
        return response;
      });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(responded).toBe(false);
    accept("delayed-message");
    const response = await pendingResponse;
    expect(response.status).toBe(202);
  });

  it.each([
    ["invalid JSON", "{"],
    ["a null root", "null"],
    ["an array root", "[]"],
    ["a boolean root", "true"],
    ["a missing number", "{}"],
    ["a null number", '{"number":null}'],
    ["a boolean number", '{"number":true}'],
    ["a string number", '{"number":"101"}'],
    ["an array number", '{"number":[101]}'],
    ["an object number", '{"number":{"value":101}}'],
    ["an overflowing number", '{"number":1e999}'],
  ])("rejects %s without publishing", async (_label, body) => {
    const published: number[] = [];
    const app = createServerApp({
      publish: async (number) => {
        published.push(number);
        return "unexpected";
      },
      logger,
    });

    const response = await app.request("/", post(body));

    expect(response.status).toBe(400);
    expect(published).toEqual([]);
  });

  it("returns a retryable response when publication fails", async () => {
    const app = createServerApp({
      publish: async () => {
        throw new Error("Pub/Sub unavailable");
      },
      logger,
    });

    const response = await app.request("/", post('{"number":101}'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Message publication failed",
    });
  });
});
