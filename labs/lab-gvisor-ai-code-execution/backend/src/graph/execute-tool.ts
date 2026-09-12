import { setTimeout as delay } from "node:timers/promises";
import { ExecutionBusy } from "../execution/execute.js";
import type { ExecutePython } from "../execution/types.js";
export type ToolExecutor = (
	input: Parameters<ExecutePython>[0],
	signal?: AbortSignal,
	onRegistered?: (executionId: string) => Promise<void>,
) => ReturnType<ExecutePython>;
export async function executeTool(
	execute: ToolExecutor,
	input: Parameters<ExecutePython>[0],
	signal: AbortSignal,
	onRegistered: (id: string) => Promise<void>,
) {
	for (;;) {
		signal.throwIfAborted();
		try {
			return await execute(input, signal, onRegistered);
		} catch (err) {
			if (!(err instanceof ExecutionBusy)) throw err;
			await delay(100, undefined, { signal });
		}
	}
}
