import type { Evidence, Source } from "../corpus/types.js";
export type Message = { role: "user" | "assistant"; content: string };
export type Answer = { answer: string; sources: Source[] };
export type AgentEvent =
	| { type: "status"; stage: "searching" | "answering" }
	| { type: "sources"; sources: Source[] }
	| { type: "delta"; text: string }
	| ({ type: "done" } & Answer)
	| { type: "error"; message: string };
export type Run = {
	history: Message[];
	query: string;
	retrieve: (question: string, signal: AbortSignal) => Promise<Evidence>;
	emit: (event: AgentEvent) => void;
	signal: AbortSignal;
};
export type Provider = {
	mode: "scripted" | "live";
	run: (run: Run) => Promise<Answer>;
	secret: (signal: AbortSignal) => Promise<string | undefined>;
};
