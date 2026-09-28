/**
 * Structured JSON logger shared by the viewer and the verifier.
 *
 * Logs go to stderr, not stdout: stdout carries the rendered live view
 * (Task 7) or the verification summary (Tasks 8-9), so log lines must
 * never mix into either.
 */
import pino from "pino";

export type Logger = pino.Logger;

export function createLogger({ appName }: { appName: string }): Logger {
  return pino(
    {
      base: { appName },
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: { err: pino.stdSerializers.errWithCause },
      level: process.env.LOG_LEVEL ?? "info",
    },
    pino.destination(2),
  );
}

/** Logs and exits on an uncaught exception or unhandled rejection. */
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
