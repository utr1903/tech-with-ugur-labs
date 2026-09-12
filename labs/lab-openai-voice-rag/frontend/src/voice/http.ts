import type { Answer, Token } from "./transport.js";

async function request(
	path: string,
	body: unknown,
	signal: AbortSignal,
): Promise<unknown> {
	const response = await fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	if (!response.ok) throw Error("Request failed");
	return response.json();
}
export async function fetchToken(signal: AbortSignal): Promise<Token> {
	const data = await request(
		"/api/realtime/token",
		{},
		AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
	);
	if (
		!data ||
		typeof data !== "object" ||
		!("mode" in data) ||
		!("conversationId" in data) ||
		typeof data.conversationId !== "string" ||
		(data.mode !== "scripted" && data.mode !== "live")
	)
		throw Error("Invalid session");
	if (
		data.mode === "live" &&
		(!("clientSecret" in data) || typeof data.clientSecret !== "string")
	)
		throw Error("Invalid session");
	return data as Token;
}
export async function fetchAnswer(
	token: Token,
	question: string,
	signal: AbortSignal,
): Promise<Answer> {
	const data = await request(
		"/api/agent",
		{ conversationId: token.conversationId, question },
		AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
	);
	if (
		!data ||
		typeof data !== "object" ||
		!("answer" in data) ||
		typeof data.answer !== "string" ||
		!("sources" in data) ||
		!Array.isArray(data.sources)
	)
		throw Error("Invalid answer");
	return data as Answer;
}
