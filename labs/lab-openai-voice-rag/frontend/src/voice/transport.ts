export type Source = {
	id: string;
	filename: string;
	ordinal: number;
	text: string;
};
export type Answer = { answer: string; sources: Source[] };
export type AgentEvent =
	| { type: "status"; stage: "searching" | "answering" }
	| { type: "sources"; sources: Source[] }
	| { type: "delta"; text: string }
	| ({ type: "done" } & Answer)
	| { type: "error"; message: string };
export type Token = { mode: "scripted" | "live"; clientSecret?: string };
export type Call = { id: string; question: string };
export type Transport = {
	start(
		token: Token,
		call: (call: Call) => void,
		fail: () => void,
		interrupt: () => void,
	): Promise<void>;
	say(text: string): void;
	clearSpeech(): void;
	question(question: string): void;
	dispose(): void;
};
export type State = {
	status: string;
	mode?: Token["mode"];
	query?: string;
	answer?: Answer;
	error?: string;
};
export type Dependencies = {
	sessionId(): string;
	token(signal: AbortSignal): Promise<Token>;
	relay(
		sessionId: string,
		query: string,
		signal: AbortSignal,
		onEvent: (event: AgentEvent) => void,
	): Promise<Answer>;
	transport(mode: Token["mode"]): Transport;
	change(state: State): void;
};
