import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ResearchToolOptions, ToolResult } from "./firecrawl-types.js";
import { validateDiscoveredUrl, validatePublicUrl } from "./scope.js";

export class ResearchDenied extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export function createBoundary(options: ResearchToolOptions) {
  const { ledger, logger, clock } = options;
  const deadline = clock.now() + ledger.limits.maxDurationMs;
  const resolveDns =
    options.resolveDns ??
    (async (host: string) =>
      (await lookup(host, { all: true })).map((answer) => answer.address));
  const remaining = () => Math.max(0, deadline - clock.now());
  const timed = async <T>(work: () => Promise<T>): Promise<T> => {
    const duration = remaining();
    if (duration <= 0) throw new ResearchDenied("time-budget");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ResearchDenied("time-budget")),
            duration,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const publicDns = async (url: string): Promise<void> => {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    let answers: string[];
    try {
      answers = isIP(host) ? [host] : await timed(() => resolveDns(host));
    } catch (err) {
      if (err instanceof ResearchDenied) throw err;
      throw new ResearchDenied("dns-failure");
    }
    const publicAddress = (address: string) =>
      isIP(address) &&
      validatePublicUrl(
        `https://${isIP(address) === 6 ? `[${address}]` : address}/`,
      ).valid;
    // Local validation cannot control Firecrawl's later DNS resolution or redirects.
    if (!answers.length || !answers.every(publicAddress))
      throw new ResearchDenied("dns-private");
  };
  const validate = (raw: string, referringUrl?: string) => {
    if (!referringUrl) {
      const result = validatePublicUrl(raw);
      if (!result.valid) throw new ResearchDenied(result.reason);
      return result;
    }
    const reference = validatePublicUrl(referringUrl);
    if (!reference.valid) throw new ResearchDenied(reference.reason);
    let resolved: string;
    try {
      resolved = new URL(raw, reference.url).href;
    } catch {
      throw new ResearchDenied("malformed");
    }
    const result = validateDiscoveredUrl(resolved, reference.host);
    if (!result.valid) throw new ResearchDenied(result.reason);
    return result;
  };
  const call = async <T>(
    operation: string,
    target: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    validate(target);
    if (remaining() <= 0) throw new ResearchDenied("time-budget");
    await publicDns(target);
    if (target !== "https://api.firecrawl.dev/")
      await publicDns("https://api.firecrawl.dev/");
    if (!ledger.takeCall(operation, target))
      throw new ResearchDenied("call-budget");
    ledger.record({ kind: "attempt", operation, url: target });
    return timed(work);
  };
  const execute = async <T extends object>(
    operation: string,
    url: string,
    work: () => Promise<T>,
  ): Promise<ToolResult<T>> => {
    ledger.record({ kind: "attempt", operation, url });
    logger.info({ url }, `${operation}...`);
    try {
      if (remaining() <= 0) throw new ResearchDenied("time-budget");
      const result = await work();
      logger.info(
        { sourceCount: ledger.snapshot().sources.length },
        `${operation} succeeded.`,
      );
      return { ok: true, ...result };
    } catch (err) {
      return handleError(options, operation, url, err);
    }
  };
  let queue = Promise.resolve();
  const run = async <T extends object>(
    operation: string,
    url: string,
    work: () => Promise<T>,
  ): Promise<ToolResult<T>> => {
    const previous = queue;
    let release = () => {};
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await execute(operation, url, work);
    } finally {
      release();
    }
  };
  return { validate, publicDns, call, run, remaining };
}

function handleError(
  options: ResearchToolOptions,
  operation: string,
  url: string,
  err: unknown,
): ToolResult<never> {
  const { ledger, logger } = options;
  if (err instanceof ResearchDenied) {
    const reason = err.reason;
    ledger.record({
      kind: reason.endsWith("budget") ? "cap" : "denial",
      operation,
      url,
      reason,
    });
    logger.warn({ url, reason }, `${operation} denied.`);
    return { ok: false, recoverable: true, reason };
  }
  const status = providerStatus(err);
  const authentication = status === 401 || status === 403;
  const reason = authentication ? "authentication" : "provider-error";
  const safeError = new Error(
    authentication
      ? "Firecrawl authentication failed"
      : "Firecrawl operation failed",
  );
  ledger.record({ kind: "failure", operation, url, reason });
  logger.error({ err: safeError, url, status }, `${operation} failed.`);
  throw safeError;
}

function providerStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  if ("status" in err && typeof err.status === "number") return err.status;
  if ("statusCode" in err && typeof err.statusCode === "number")
    return err.statusCode;
  return undefined;
}
export type Boundary = ReturnType<typeof createBoundary>;
