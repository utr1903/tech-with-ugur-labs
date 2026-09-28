import pino from "pino";

/** The logger type every module accepts; modules never create their own. */
export type Logger = pino.Logger;

/**
 * Creates the one root logger of the app. It writes JSON lines to stdout so
 * `make logs` output can be filtered line by line.
 */
export function createLogger({
  appName,
  level,
}: {
  appName: string;
  level: string;
}): Logger {
  return pino({
    base: { appName },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: pino.stdSerializers.errWithCause },
    level,
  });
}

/** Logs and exits on errors nothing else caught, so failures are never silent. */
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
