import type { Logger } from "../logger.js";

const PATHS = [
  "/products",
  "/preview?url=http://payments-api.payments.svc/healthz",
];

export function pickRequest(rand: () => number): { path: string } {
  return {
    path: PATHS[Math.floor(rand() * PATHS.length)] ?? PATHS[0] ?? "/products",
  };
}

function nextDelayMs(rand: () => number): number {
  return 2000 + Math.floor(rand() * 3000);
}

/** Normal-user traffic: one request every 2-5 s, forever. */
export async function runLoadgen(
  logger: Logger,
  target: string,
): Promise<never> {
  for (;;) {
    const { path } = pickRequest(Math.random);
    try {
      logger.info({ path }, "Requesting storefront...");
      const res = await fetch(`${target}${path}`, {
        signal: AbortSignal.timeout(5000),
      });
      await res.arrayBuffer();
      logger.info(
        { path, status: res.status },
        "Requesting storefront succeeded.",
      );
    } catch (err) {
      logger.error({ err, path }, "Requesting storefront failed.");
    }
    await new Promise((r) => setTimeout(r, nextDelayMs(Math.random)));
  }
}
