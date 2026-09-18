import pino from "pino";

export type Logger = pino.Logger;

// Not exported: this app has exactly one call site (the singleton below) —
// unlike a CLI or server entrypoint, no other module in a Next.js app builds
// its own logger instance.
function createLogger({ appName }: { appName: string }): Logger {
  return pino({
    base: { appName },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: pino.stdSerializers.errWithCause },
    level: process.env.LOG_LEVEL ?? "info",
  });
}

export function installGlobalErrorHandlers(logger: Logger): void {
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception.");
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "Unhandled rejection.");
    process.exit(1);
  });
}

// Next.js has no single process entrypoint for a route module the way a CLI
// or server has `index.ts`: every request can load this module fresh, so the
// logger is created once here, at module scope, and imported wherever an
// operation needs it (see `server-proxy.ts`).
export const logger = createLogger({ appName: "code-sandbox-web" });
