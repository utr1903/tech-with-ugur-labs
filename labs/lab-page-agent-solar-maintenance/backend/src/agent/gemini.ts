import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { ChatRequest } from "./guard.js";

/**
 * An upstream error body is a diagnostic from someone else's server, and it
 * ends up in our logs. Bound it, and scrub anything credential-shaped: a
 * verbose or misconfigured endpoint that echoed the request back would
 * otherwise put a live key straight into the log file.
 */
function safeUpstreamDetail(body: string): string {
  return body
    .slice(0, 200)
    .replace(/Bearer\s+[\w.~+/-]+=*/g, "Bearer [redacted]")
    .replace(/AIza[\w-]{35}/g, "[redacted]");
}

/**
 * Forwards a cleaned request upstream with the key this process holds. The key
 * never travels to the browser, and the browser's Authorization header never
 * travels upstream — these headers are built from scratch, and nothing from the
 * inbound request is spread into them.
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
          `Gemini returned HTTP ${response.status}: ${safeUpstreamDetail(await response.text())}`,
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
