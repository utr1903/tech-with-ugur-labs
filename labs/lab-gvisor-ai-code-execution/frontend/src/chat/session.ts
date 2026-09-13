import type { ClientTurn, Message } from "./transport";
export type Pending = { request: ClientTurn; cursor: number };
const memory = new Map<string, Pending>();
const key = (id: string) => `contained-chat:pending:${id}`;
export function savePending(id: string, pending: Pending): boolean {
	memory.set(id, pending);
	try {
		localStorage.setItem(key(id), JSON.stringify(pending));
		return true;
	} catch {
		return false;
	}
}
export function loadPending(id: string): Pending | null {
	if (memory.has(id)) return memory.get(id) ?? null;
	try {
		const raw = localStorage.getItem(key(id));
		if (!raw) return null;
		const value = JSON.parse(raw);
		if (
			!Number.isSafeInteger(value?.cursor) ||
			value.cursor < 0 ||
			!validTurn(value.request)
		)
			throw new Error();
		return value;
	} catch {
		throw new Error(
			"Saved request unavailable. Canonical history restored; refresh to check any running turn.",
		);
	}
}
function validTurn(value: unknown): value is ClientTurn {
	if (!value || typeof value !== "object") return false;
	const turn = value as ClientTurn;
	const id = (v: unknown) =>
		typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
	return (
		id(turn.turnId) &&
		Array.isArray(turn.messages) &&
		turn.messages.length > 0 &&
		turn.messages.length <= 64 &&
		turn.messages.every(
			(m) =>
				m &&
				id(m.id) &&
				m.role === "user" &&
				typeof m.text === "string" &&
				m.text.length > 0 &&
				new TextEncoder().encode(m.text).length <= 16384,
		) &&
		new TextEncoder().encode(JSON.stringify(value)).length <= 131072
	);
}
export function clearPending(id: string) {
	memory.delete(id);
	try {
		localStorage.removeItem(key(id));
	} catch {
		/* Canonical server history remains authoritative. */
	}
}
export function createTurn(
	_messages: Message[],
	text: string,
): { request: ClientTurn; message: Message } {
	if (!text.length || new TextEncoder().encode(text).length > 16384)
		throw new Error(
			"Message must contain 1–16 KiB of UTF-8 text. Shorten it and send again.",
		);
	const message = { id: crypto.randomUUID(), role: "user" as const, text };
	const request = { turnId: crypto.randomUUID(), messages: [message] };
	if (!validTurn(request))
		throw new Error("Request too large. Shorten your message and send again.");
	return { message, request };
}
