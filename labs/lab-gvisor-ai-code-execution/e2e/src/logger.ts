import pino from "pino";
export type Logger = pino.Logger;
export function createLogger({ appName }: { appName: string }): Logger {
	return pino({
		base: { appName },
		timestamp: pino.stdTimeFunctions.isoTime,
		serializers: {
			err: (err: unknown) => pino.stdSerializers.errWithCause(err as Error),
		},
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
