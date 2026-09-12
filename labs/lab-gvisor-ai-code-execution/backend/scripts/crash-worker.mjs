import { fixture } from "../src/execution/integration-fixture.ts";
import { setupChat } from "../src/graph/graph.ts";
import { ScriptedModel } from "../src/graph/scripted.ts";
import { ThreadService } from "../src/threads/service.ts";

const f = fixture();
const crash = () => process.kill(process.pid, "SIGKILL");
const point = process.env.CRASH_POINT;
const original = f.pool.query.bind(f.pool);
f.pool.query = new Proxy(original, {
	apply(target, self, args) {
		const result = Reflect.apply(target, self, args);
		if (
			point === "action" &&
			typeof args[0] === "string" &&
			args[0].startsWith("INSERT INTO chat_actions")
		)
			return result.then((value) => {
				crash();
				return value;
			});
		return result;
	},
});
if (point === "result")
	f.api.deleteJob = async () => {
		crash();
	};
const execute = (input, signal, onRegistered) =>
	f.executor.execute(input, signal, async (id) => {
		await onRegistered?.(id);
		if (point === "registered") crash();
	});
const graph = await setupChat(
	f.pool,
	new ScriptedModel("tool", "print(81)"),
	execute,
);
const service = new ThreadService(f.pool, graph, f.logger);
await service.start(process.env.CRASH_THREAD, {
	turnId: process.env.CRASH_TURN,
	messages: [{ id: "u1", role: "user", text: "calculate" }],
});
await service.waitIdle();
await f.pool.end();
