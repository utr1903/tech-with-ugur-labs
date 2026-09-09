import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { ChatRequest } from "./guard.js";

/**
 * Forwards a cleaned request upstream with the key this process holds. The key
 * never travels to the browser, and the browser's Authorization header never
 * travels upstream.
 */
export function createGeminiTransport(config: Config, logger: Logger) {
  return async function forward(request: ChatRequest): Promise<unknown> {
    const url = `${config.geminiBaseUrl}/chat/completions`;
    try {
      logger.info({ model: request.model }, "Forwarding a step to Gemini...");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.geminiApiKey}`,
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error(
          `Gemini returned HTTP ${response.status}: ${await response.text()}`,
        );
      }
      const body = await response.json();
      logger.info(
        { model: request.model },
        "Forwarding a step to Gemini succeeded.",
      );
      return body;
    } catch (err) {
      logger.error(
        { err, model: request.model },
        "Forwarding a step to Gemini failed.",
      );
      throw err;
    }
  };
}
