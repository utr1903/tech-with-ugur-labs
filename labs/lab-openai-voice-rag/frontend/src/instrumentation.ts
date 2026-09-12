import type { Instrumentation } from "next";
import type { createLogger } from "./logger";

let logger: ReturnType<typeof createLogger> | undefined;
export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		if (!logger) logger = (await import("./logger")).createLogger();
		logger.info({ runtime: "nodejs" }, "Frontend initialization succeeded.");
	}
}
export const onRequestError: Instrumentation.onRequestError = async (
	err,
	_request,
	context,
) => {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		if (!logger) logger = (await import("./logger")).createLogger();
		logger.error({ err, route: context.routePath }, "Frontend request failed.");
	}
};
