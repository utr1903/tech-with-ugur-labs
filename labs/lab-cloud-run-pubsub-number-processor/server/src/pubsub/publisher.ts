import { PubSub } from "@google-cloud/pubsub";
import type { Logger } from "../logger.js";

export type PublishNumber = (number: number) => Promise<string>;

interface PublishTopic {
  publishMessage(message: { data: Buffer }): Promise<string>;
}

export function createPublishNumber({
  topic,
  logger,
}: {
  topic: PublishTopic;
  logger: Logger;
}): PublishNumber {
  return async (number) => {
    try {
      logger.info({ number }, "Publishing number...");
      const messageId = await topic.publishMessage({
        data: Buffer.from(JSON.stringify({ number })),
      });
      logger.info({ messageId, number }, "Publishing number succeeded.");
      return messageId;
    } catch (err) {
      logger.error({ err, number }, "Publishing number failed.");
      throw err;
    }
  };
}

export function createGooglePublishNumber({
  projectId,
  topicName,
  logger,
}: {
  projectId: string;
  topicName: string;
  logger: Logger;
}): PublishNumber {
  const pubsub = new PubSub({ projectId });
  return createPublishNumber({ topic: pubsub.topic(topicName), logger });
}
