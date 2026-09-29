import type { createDeepAgent } from "deepagents";
import type OpenAI from "openai";
import type { Logger } from "pino";
import type { SourceCitation, ToolEvent } from "../report/coverage.js";
import type { ReadResult } from "../retrieval/reader.js";
import type { searchWeb } from "./search.js";
export interface AgentInput {
	instruction: string;
	requestedUrls: string[];
	notes: { name: string; text: string }[];
	workspaceDir: string;
	model: string;
	searchModel?: string;
	client: OpenAI;
	logger: Logger;
}
export type AgentOptions = NonNullable<Parameters<typeof createDeepAgent>[0]>;
export interface AgentDependencies {
	read?: (url: string) => Promise<ReadResult>;
	search?: typeof searchWeb;
	createAgent?: (options: AgentOptions) => {
		invoke: (
			input: { messages: { role: "user"; content: string }[] },
			config: { recursionLimit: number },
		) => Promise<{ messages: { type: string; content: unknown }[] }>;
	};
}
export interface AgentOutput {
	report: string;
	results: ReadResult[];
	supplemental: SourceCitation[];
	events: ToolEvent[];
}
