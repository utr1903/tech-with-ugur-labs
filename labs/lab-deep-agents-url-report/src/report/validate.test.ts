import { expect, test } from "vitest";
import { createCoverage } from "./coverage.js";
import { validateReport } from "./validate.js";

const manifest = createCoverage(
	[
		{
			requestedUrl: "https://example.com/a",
			finalUrl: "https://example.com/a",
			status: "ok",
			text: "A",
		},
		{
			requestedUrl: "https://example.org/b",
			finalUrl: "https://example.org/b",
			status: "ok",
			text: "B",
		},
	],
	[],
	[],
);

test("accepts a report with requested headings, comparative analysis, and cited requested URLs", () => {
	const report =
		"# Study\n\n## Summary\nA summary.\n\n## Risks\nA risk.\n\n## Comparison\nSource A is faster, whereas source B is cheaper.\n\n## Sources\n[First](https://example.com/a) and [Second](https://example.org/b).";

	expect(
		validateReport(
			report,
			"Compare the sources. Use headings Summary and Risks.",
			manifest,
		),
	).toEqual([]);
});

test("reports empty content and missing requested headings", () => {
	expect(
		validateReport("", "Use headings Summary and Risks.", manifest),
	).toEqual(
		expect.arrayContaining([
			"Report is empty.",
			"Missing requested heading: Summary",
			"Missing requested heading: Risks",
		]),
	);
});

test("reports every successful requested URL lacking a Markdown citation", () => {
	const report =
		"# Report\n\nhttps://example.com/a appears as plain text.\n\n[Supplement](https://news.example/current)";

	expect(validateReport(report, "Summarize the sources.", manifest)).toEqual(
		expect.arrayContaining([
			"Missing requested source citation: https://example.com/a",
			"Missing requested source citation: https://example.org/b",
		]),
	);
});

test("reports a missing comparison when the instruction requests one", () => {
	const report =
		"# Report\n\n## Summary\nTwo sources were read.\n\n[First](https://example.com/a) [Second](https://example.org/b)";

	expect(
		validateReport(
			report,
			"Compare the sources by cost and latency.",
			manifest,
		),
	).toContain("Missing cross-source comparison.");
});

test("requires failed retrievals to be stated explicitly", () => {
	const failed = createCoverage(
		[
			{
				requestedUrl: "https://example.com/large",
				status: "failed",
				error: "Response exceeds byte limit",
			},
		],
		[],
		[],
	);

	expect(
		validateReport("# Report\n\nSome findings.", "Summarize.", failed),
	).toContain("Missing failure disclosure: https://example.com/large");
});
