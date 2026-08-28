import type { Logger } from "../logger.js";

const IMAGE_URL_PATTERN = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;

// Pulls every markdown image URL out of model output, in document order.
export function extractImageUrls(markdown: string): string[] {
  return [...markdown.matchAll(IMAGE_URL_PATTERN)].map((match) => match[1]);
}

export interface FetchDeps {
  logger: Logger;
  fetchFn?: typeof fetch;
}

// DELIBERATELY VULNERABLE: auto-fetching URLs from model output turns rendered markdown into an exfiltration channel.
export async function fetchImageUrls(
  deps: FetchDeps,
  urls: string[],
): Promise<void> {
  const { logger, fetchFn } = deps;
  const doFetch = fetchFn ?? fetch;

  for (const url of urls) {
    try {
      logger.info({ url }, "Fetching image URL...");
      await doFetch(url);
      logger.info({ url }, "Fetching image URL succeeded.");
    } catch (err) {
      logger.warn({ err, url }, "Fetching image URL failed.");
    }
  }
}
