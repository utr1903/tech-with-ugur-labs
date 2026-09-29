import { expect, test } from "vitest";
import { appendCoverage, createCoverage } from "./coverage.js";

const results = [
	{
		requestedUrl: "https://example.com/first",
		finalUrl: "https://example.com/final",
		status: "ok" as const,
		text: "Retrieved page text must stay out of the manifest.",
	},
	{
		requestedUrl: "https://example.org/large",
		finalUrl: "https://example.org/large",
		status: "failed" as const,
		error: "Response exceeds byte limit",
	},
	{
		requestedUrl: "https://example.net/binary",
		status: "failed" as const,
		error: "Unsupported content type",
	},
];

test("coverage records ordered outcomes and counts without retrieved text", () => {
	const manifest = createCoverage(results, [], []);

	expect(manifest).toEqual({
		status: "partial",
		requestedCount: 3,
		successfulCount: 1,
		failedCount: 2,
		requested: [
			{
				requestedUrl: "https://example.com/first",
				finalUrl: "https://example.com/final",
				status: "ok",
			},
			{
				requestedUrl: "https://example.org/large",
				finalUrl: "https://example.org/large",
				status: "failed",
				error: "Response exceeds byte limit",
			},
			{
				requestedUrl: "https://example.net/binary",
				status: "failed",
				error: "Unsupported content type",
			},
		],
		supplemental: [],
		events: [],
	});
});

test("supplemental search citations and tool events remain separate from requested sources", () => {
	const supplemental = [
		{ url: "https://news.example/current", title: "Current news" },
	];
	const events = [
		{
			tool: "read_url" as const,
			input: "https://example.com/first",
			status: "ok" as const,
		},
		{
			tool: "web_search_call" as const,
			input: "latest context",
			status: "ok" as const,
		},
	];
	const manifest = createCoverage(results.slice(0, 1), supplemental, events);

	expect(manifest.status).toBe("complete");
	expect(manifest.requestedCount).toBe(1);
	expect(manifest.supplemental).toEqual(supplemental);
	expect(manifest.events).toEqual(events);
	expect(manifest.requested).toHaveLength(1);
});

test("appendix links every requested source and explicitly describes failed reads", () => {
	const report = appendCoverage(
		"# Findings\n\nAnalysis.",
		createCoverage(results, [], []),
	);

	expect(report).toContain("# Findings\n\nAnalysis.");
	expect(report).toContain("## Source coverage");
	expect(report).toContain(
		"[https://example.com/first](https://example.com/first)",
	);
	expect(report).toContain(
		"[https://example.com/final](https://example.com/final)",
	);
	expect(report).toContain(
		"[https://example.org/large](https://example.org/large)",
	);
	expect(report).toContain("Failed: Response exceeds byte limit");
	expect(report).toContain("Failed: Unsupported content type");
	expect(report.indexOf("example.com/first")).toBeLessThan(
		report.indexOf("example.org/large"),
	);
	expect(report.indexOf("example.org/large")).toBeLessThan(
		report.indexOf("example.net/binary"),
	);
	expect(report).not.toContain("Retrieved page text");
});

test("supplemental citations have a separate appendix subsection", () => {
	const manifest = createCoverage(
		results.slice(0, 1),
		[{ url: "https://news.example/current", title: "Current news" }],
		[],
	);
	const report = appendCoverage("# Findings", manifest);

	expect(report).toContain("### Supplemental web search sources");
	expect(report).toContain("[Current news](https://news.example/current)");
	expect(report.indexOf("### Requested sources")).toBeLessThan(
		report.indexOf("### Supplemental web search sources"),
	);
});
