import type { EventEmitter } from "node:events";
import pino from "pino";
import { expect, it, vi } from "vitest";
import { installGlobalErrorHandlers } from "./logger.js";

it("withholds raw error contents in both process-wide boundaries", () => {
	const logs: string[] = [];
	const logger = pino(
		{ level: "info" },
		{
			write: (chunk) => {
				logs.push(chunk);
			},
		},
	);
	const emitter: EventEmitter = process;
	const events = ["uncaughtException", "unhandledRejection"] as const;
	const before = events.map((event) => emitter.listeners(event));
	const exit = vi.spyOn(process, "exit").mockImplementation(() => {
		throw Error("intercepted exit");
	});
	try {
		installGlobalErrorHandlers(logger);
		events.forEach((event, index) => {
			const handler = emitter
				.listeners(event)
				.find((listener) => !before[index]?.includes(listener));
			if (!handler) throw Error("missing global handler");
			expect(() => handler(Error("sk-private-provider-message"))).toThrow(
				"intercepted exit",
			);
			emitter.removeListener(event, handler as (...args: unknown[]) => void);
		});
		expect(logs.join("")).not.toContain("sk-private");
		expect(logs.join("")).toContain("Service operation failed");
	} finally {
		exit.mockRestore();
		events.forEach((event, index) => {
			for (const listener of emitter.listeners(event))
				if (!before[index]?.includes(listener))
					emitter.removeListener(
						event,
						listener as (...args: unknown[]) => void,
					);
		});
	}
});
