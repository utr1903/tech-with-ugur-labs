import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { Logger } from "../logger.js";

const capabilitiesSchema = z.object({
  pythonVersion: z.string(),
  modules: z
    .array(
      z.object({
        importName: z.string(),
        distribution: z.string(),
        version: z.string(),
      }),
    )
    .min(1),
  limits: z.object({
    executionTimeoutSeconds: z.number().positive(),
    maxCodeBytes: z.number().int().positive(),
    maxStdoutBytes: z.number().int().positive(),
    maxStderrBytes: z.number().int().positive(),
    maxResultBytes: z.number().int().positive(),
    maxConcurrentExecutions: z.number().int().positive(),
  }),
  network: z.string(),
  persistence: z.string(),
  structuredResult: z.string(),
});

export type Capabilities = z.infer<typeof capabilitiesSchema>;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface FetchCapabilitiesOptions {
  sandboxUrl: string;
  logger: Logger;
  fetchImpl?: FetchLike;
  attempts?: number;
  delayMs?: number;
}

async function fetchOnce(
  url: string,
  fetchImpl: FetchLike,
): Promise<Capabilities> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`sandbox answered HTTP ${response.status}`);
  return capabilitiesSchema.parse(await response.json());
}

// The tool description is generated from this document, so the server does
// not start until the sandbox it will describe is actually up.
export async function fetchCapabilities({
  sandboxUrl,
  logger,
  fetchImpl = fetch,
  attempts = 30,
  delayMs = 2_000,
}: FetchCapabilitiesOptions): Promise<Capabilities> {
  const url = new URL("/capabilities", sandboxUrl).toString();
  logger.info({ url, attempts }, "Fetching sandbox capabilities...");
  for (let attempt = 1; ; attempt += 1) {
    try {
      const capabilities = await fetchOnce(url, fetchImpl);
      logger.info(
        { modules: capabilities.modules.map((m) => m.importName) },
        "Fetching sandbox capabilities succeeded.",
      );
      return capabilities;
    } catch (err) {
      if (attempt >= attempts) {
        logger.error(
          { err, url, attempt },
          "Fetching sandbox capabilities failed.",
        );
        throw err;
      }
      logger.warn({ err, url, attempt }, "Sandbox not ready yet; retrying.");
      await sleep(delayMs);
    }
  }
}
