type Source = {
	id: string;
	filename: string;
	ordinal: number;
	text: string;
};
export type Answer = { answer: string; sources: Source[] };
export type Token = {
	mode: "scripted" | "live";
	conversationId: string;
	clientSecret?: string;
};
export type Call = { id: string; question: string };
export type Transport = {
	start(
		token: Token,
		call: (call: Call) => void,
		fail: () => void,
	): Promise<void>;
	output(id: string, result: Answer | { error: string }): void;
	question(question: string): void;
	dispose(): void;
};
export type State = {
	status: string;
	mode?: Token["mode"];
	answer?: Answer;
	error?: string;
};
export type Dependencies = {
	token(signal: AbortSignal): Promise<Token>;
	relay(token: Token, question: string, signal: AbortSignal): Promise<Answer>;
	transport(mode: Token["mode"]): Transport;
	change(state: State): void;
};
