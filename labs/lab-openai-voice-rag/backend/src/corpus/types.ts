export type EmbeddingIdentity = {
	provider: string;
	model: string;
	dimensions: 1536;
};
export type Source = {
	id: string;
	filename: string;
	ordinal: number;
	text: string;
};
export type Evidence = { sources: Source[]; context: string };
export type Embed = (
	texts: string[],
	signal?: AbortSignal,
) => Promise<number[][]>;
export type Refresh = {
	added: number;
	changed: number;
	deleted: number;
	unchanged: number;
};
