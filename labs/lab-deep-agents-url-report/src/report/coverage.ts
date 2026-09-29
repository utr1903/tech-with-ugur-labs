import type { ReadResult } from "../retrieval/reader.js";

export interface SourceCitation {
	url: string;
	title?: string;
}

export interface ToolEvent {
	tool: "read_url" | "web_search_call";
	input: string;
	status: "ok" | "failed";
	error?: string;
}

export interface CoverageManifest {
	status: "complete" | "partial";
	requestedCount: number;
	successfulCount: number;
	failedCount: number;
	requested: Omit<ReadResult, "text">[];
	supplemental: SourceCitation[];
	events: ToolEvent[];
}

export function createCoverage(
	results: ReadResult[],
	supplemental: SourceCitation[],
	events: ToolEvent[],
): CoverageManifest {
	const requested = results.map(
		({ requestedUrl, finalUrl, status, error }) => ({
			requestedUrl,
			...(finalUrl === undefined ? {} : { finalUrl }),
			status,
			...(error === undefined ? {} : { error }),
		}),
	);
	const successfulCount = requested.filter(
		(entry) => entry.status === "ok",
	).length;
	const failedCount = requested.length - successfulCount;
	return {
		status: failedCount > 0 ? "partial" : "complete",
		requestedCount: requested.length,
		successfulCount,
		failedCount,
		requested,
		supplemental: [...supplemental],
		events: [...events],
	};
}

function sourceLink(url: string, label = url): string {
	return `[${label.replaceAll("]", "\\]")}](${url})`;
}

export function appendCoverage(
	report: string,
	manifest: CoverageManifest,
): string {
	const lines = ["## Source coverage", "", "### Requested sources", ""];
	for (const entry of manifest.requested) {
		const original = sourceLink(entry.requestedUrl);
		const final =
			entry.finalUrl && entry.finalUrl !== entry.requestedUrl
				? ` (final URL: ${sourceLink(entry.finalUrl)})`
				: "";
		const outcome =
			entry.status === "ok"
				? "Read successfully"
				: `Failed: ${entry.error ?? "Reading URL failed"}`;
		lines.push(`- ${original}${final} — ${outcome}`);
	}
	if (manifest.requested.length === 0) lines.push("No requested URLs.");
	if (manifest.supplemental.length > 0) {
		lines.push("", "### Supplemental web search sources", "");
		for (const citation of manifest.supplemental) {
			lines.push(
				`- ${sourceLink(citation.url, citation.title ?? citation.url)}`,
			);
		}
	}
	return `${report.trimEnd()}\n\n${lines.join("\n")}\n`;
}
