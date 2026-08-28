import type { RequestHandler } from "express";
import type { AppConfig } from "../config.js";
import { isAllowedUrl } from "../egress/allowlist.js";
import { extractImageUrls, fetchImageUrls } from "../egress/image-fetch.js";
import type { Logger } from "../logger.js";
import { buildAssistantPrompt } from "../model/prompts.js";

export interface AssistantDeps {
  config: AppConfig;
  logger: Logger;
  chatFn: (prompt: string) => Promise<string>;
  fetchFn?: typeof fetch;
}

interface AssistantRequestBody {
  document: string;
  question: string;
}

export function createAssistantHandler(deps: AssistantDeps): RequestHandler {
  const { config, logger, chatFn, fetchFn } = deps;

  return async (req, res) => {
    const { document, question } = req.body as AssistantRequestBody;

    try {
      logger.info(
        { variant: config.variant },
        "Answering assistant question...",
      );
      const prompt = buildAssistantPrompt({
        variant: config.variant,
        secret: config.assistantSecret,
        document,
        question,
      });
      const answer = await chatFn(prompt);
      const imageUrls = extractImageUrls(answer);

      if (config.variant === "vulnerable") {
        // DELIBERATELY VULNERABLE: auto-fetches every image URL the model emitted,
        // including ones an attacker planted inside the document, turning the
        // assistant into an exfiltration channel.
        await fetchImageUrls({ logger, fetchFn }, imageUrls);
      } else {
        const allowed = imageUrls.filter((url) => {
          const ok = isAllowedUrl(url, []);
          if (!ok) {
            logger.warn(
              { url },
              "Denied fetching image URL off the allow-list.",
            );
          }
          return ok;
        });
        await fetchImageUrls({ logger, fetchFn }, allowed);
      }

      logger.info(
        { variant: config.variant },
        "Answering assistant question succeeded.",
      );
      res.json({ answer });
    } catch (err) {
      logger.error(
        { err, variant: config.variant },
        "Answering assistant question failed.",
      );
      res.status(500).json({ error: "assistant request failed" });
    }
  };
}
