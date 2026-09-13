export type Message = {
	id: string;
	role: "user" | "assistant" | "tool";
	text: string;
};
type ExecutionResult = {
	executionId: string;
	status: string;
	stdout: string;
	stderr: string;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
	runnerReportedTruncation: boolean;
	exitCode: number | null;
};
export type ChatEvent = (
	| { type: "assistant"; id: string; text: string }
	| { type: "tool-start"; id: string; executionId: string }
	| { type: "tool-result"; id: string; result: ExecutionResult }
	| { type: "done" }
	| { type: "error"; message: string }
) & { sequence: number };
export type ClientTurn = {
	turnId: string;
	messages: { id: string; role: "user"; text: string }[];
};
export function createEventDecoder() {
	let buffer = "";
	return {
		push(chunk: string): ChatEvent[] {
			buffer += chunk;
			const frames = buffer.split(/\r?\n\r?\n/);
			buffer = frames.pop() ?? "";
			return frames.flatMap((frame) => {
				const data = frame
					.split(/\r?\n/)
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trimStart())
					.join("\n");
				if (!data) return [];
				const event = JSON.parse(data) as ChatEvent;
				if (
					!Number.isSafeInteger(event.sequence) ||
					event.sequence < 1 ||
					!["assistant", "tool-start", "tool-result", "done", "error"].includes(
						event.type,
					)
				)
					throw new Error("Invalid chat event.");
				return [event];
			});
		},
	};
}
export function reconcileMessages(
	stream: Message[],
	canonical: Message[],
): Message[] {
	const ids = new Set(canonical.map((message) => message.id));
	return [...canonical, ...stream.filter((message) => !ids.has(message.id))];
}
export function applyEvent(messages: Message[], event: ChatEvent): Message[] {
	if (event.type === "done" || event.type === "error") return messages;
	const message: Message =
		event.type === "assistant"
			? { id: event.id, role: "assistant", text: event.text }
			: {
					id: `tool:${event.id}`,
					role: "tool",
					text:
						event.type === "tool-result"
							? JSON.stringify(event.result)
							: "Running Python…",
				};
	const index = messages.findIndex((existing) => existing.id === message.id);
	return index < 0
		? [...messages, message]
		: messages.map((existing, i) => (i === index ? message : existing));
}
export async function request<T>(
	base: string,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(`${base}${path}`, {
		...init,
		cache: "no-store",
	});
	if (!response.ok)
		throw new Error(`Request unavailable (${response.status}). Please retry.`);
	return response.json() as Promise<T>;
}
export class TurnRejection extends Error {
	readonly preAdmission = true;
}
export async function streamTurn(
	base: string,
	threadId: string,
	turn: ClientTurn,
	cursor: number,
	signal: AbortSignal,
	onEvent: (event: ChatEvent) => void,
) {
	const response = await fetch(`${base}/threads/${threadId}/chat`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(cursor ? { "Last-Event-ID": String(cursor) } : {}),
		},
		body: JSON.stringify(turn),
		signal,
	});
	if (!response.ok) {
		const body = await response.json().catch(() => null);
		if (
			response.status >= 400 &&
			response.status < 500 &&
			body?.code === "INVALID_TURN"
		)
			throw new TurnRejection(
				"Message rejected before submission. Shorten it and send again.",
			);
		throw new Error(
			`Chat unavailable (${response.status}). Resume to retry the same request.`,
		);
	}
	if (!response.body) throw new Error("Chat stream unavailable.");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const events = createEventDecoder();
	let terminal = false;
	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) break;
		for (const event of events.push(
			decoder.decode(chunk.value, { stream: true }),
		)) {
			onEvent(event);
			terminal ||= event.type === "done" || event.type === "error";
		}
	}
	if (!terminal) throw new Error("Connection interrupted. Resume to continue.");
}
