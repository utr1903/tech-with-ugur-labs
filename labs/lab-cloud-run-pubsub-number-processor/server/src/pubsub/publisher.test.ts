import pino from "pino";
import { expect, it } from "vitest";
import { createPublishNumber } from "./publisher.js";

const logger = pino({ enabled: false });

it("publishes the number as UTF-8 JSON and returns the message ID", async () => {
  const payloads: Buffer[] = [];
  const publish = createPublishNumber({
    topic: {
      publishMessage: async ({ data }) => {
        payloads.push(data);
        return "message-123";
      },
    },
    logger,
  });

  const messageId = await publish(101);

  expect(messageId).toBe("message-123");
  expect(payloads.map((payload) => payload.toString("utf8"))).toEqual([
    '{"number":101}',
  ]);
});

it("preserves publication failures for the HTTP boundary", async () => {
  const failure = new Error("Pub/Sub unavailable");
  const publish = createPublishNumber({
    topic: {
      publishMessage: async () => {
        throw failure;
      },
    },
    logger,
  });

  await expect(publish(101)).rejects.toBe(failure);
});
