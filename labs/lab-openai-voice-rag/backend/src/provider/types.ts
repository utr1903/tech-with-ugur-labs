import type { Evidence } from "../corpus/types.js";
export type Pending = {
	turnId: string;
	callId: string;
	name: string;
	arguments: unknown;
};
export type Step =
	| { type: "pending"; calls: Pending[] }
	| { type: "final"; answer: string };
export type ManagedSession = {
	turn(question: string, signal: AbortSignal): Promise<Step>;
	output(call: Pending, evidence: Evidence, signal: AbortSignal): Promise<Step>;
	close(): void;
};
export type Provider = {
	mode: "scripted" | "live";
	create(): ManagedSession;
	secret(signal: AbortSignal): Promise<string | undefined>;
};
