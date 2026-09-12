import type { ClientTurn, Message } from "./transport";
export type Pending = { request: ClientTurn; cursor: number };
const key = (id: string) => `contained-chat:pending:${id}`;
export function savePending(id: string, pending: Pending) {
	localStorage.setItem(key(id), JSON.stringify(pending));
}
export function loadPending(id: string): Pending | null {
	const raw = localStorage.getItem(key(id));
	return raw ? (JSON.parse(raw) as Pending) : null;
}
export function clearPending(id: string) {
	localStorage.removeItem(key(id));
}
export function createTurn(
	messages: Message[],
	text: string,
): { request: ClientTurn; message: Message } {
	const message: Message = { id: crypto.randomUUID(), role: "user", text };
	return {
		message,
		request: {
			turnId: crypto.randomUUID(),
			messages: [...messages, message]
				.filter((m): m is Message & { role: "user" } => m.role === "user")
				.map(({ id, role, text }) => ({ id, role, text })),
		},
	};
}
