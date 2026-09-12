import pino from "pino";
export function createLogger() {
	return pino({
		base: { appName: "voice-rag-frontend" },
		timestamp: pino.stdTimeFunctions.isoTime,
		serializers: { err: pino.stdSerializers.errWithCause },
		level: process.env.LOG_LEVEL ?? "info",
	});
}
export function installGlobalErrorHandlers(
	logger: ReturnType<typeof createLogger>,
): void {
	process.on("uncaughtException", (err) => {
		logger.error({ err }, "Uncaught exception.");
		process.exit(1);
	});
	process.on("unhandledRejection", (err) => {
		logger.error({ err }, "Unhandled rejection.");
		process.exit(1);
	});
}
