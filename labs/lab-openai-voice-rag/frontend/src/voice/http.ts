import { readAnswer } from "./stream-parser";
import type { AgentEvent, Answer, Token } from "./transport";

async function request(path: string, body: unknown, signal: AbortSignal) {
	const response = await fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	if (!response.ok) throw Error("Request failed");
	return response;
}
export async function fetchToken(signal: AbortSignal): Promise<Token> {
	const data = await (
		await request(
			"/api/realtime/token",
			{},
			AbortSignal.any([signal, AbortSignal.timeout(20000)]),
		)
	).json();
	if (
		!data ||
		(data.mode !== "scripted" && data.mode !== "live") ||
		(data.mode === "live" && typeof data.clientSecret !== "string")
	)
		throw Error("Invalid token");
	return {
		mode: data.mode,
		...(data.clientSecret ? { clientSecret: data.clientSecret } : {}),
	};
}
export async function fetchAnswer(
	sessionId: string,
	query: string,
	signal: AbortSignal,
	onEvent: (event: AgentEvent) => void,
): Promise<Answer> {
	const response = await request(
		"/api/agent",
		{ sessionId, query },
		AbortSignal.any([signal, AbortSignal.timeout(35000)]),
	);
	if (
		!response.body ||
		!response.headers.get("Content-Type")?.includes("application/x-ndjson")
	)
		throw Error("Invalid answer stream");
	return readAnswer(response.body, onEvent);
}
