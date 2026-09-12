import { z } from "zod";
export type UserMessage = { id: string; role: "user"; text: string };
export type ClientTurn = { turnId: string; messages: UserMessage[] };
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const request = z
	.object({
		turnId: id,
		messages: z
			.array(
				z
					.object({
						id,
						role: z.literal("user"),
						text: z
							.string()
							.min(1)
							.refine((text) => Buffer.byteLength(text) <= 16384),
					})
					.strict(),
			)
			.min(1)
			.max(64),
	})
	.strict();
export function parseTurn(value: unknown): ClientTurn {
	return request.parse(value);
}
export function reconcile(
	saved: { id: string; text: string }[],
	incoming: UserMessage[],
): UserMessage[] {
	const seen = new Set<string>();
	const result: UserMessage[] = [];
	let previous = -1;
	for (const message of incoming) {
		if (seen.has(message.id)) throw new Error("Duplicate user message.");
		seen.add(message.id);
		const position = saved.findIndex((old) => old.id === message.id);
		if (position < 0) {
			result.push(message);
			continue;
		}
		if (
			result.length ||
			position <= previous ||
			saved[position]?.text !== message.text
		)
			throw new Error("History conflict.");
		previous = position;
	}
	return result;
}
