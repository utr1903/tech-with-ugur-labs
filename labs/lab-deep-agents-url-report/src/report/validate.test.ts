import { expect, test } from "vitest";
import { appendCoverage, createCoverage } from "./coverage.js";
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
		"# Study\n\n## Summary\nA summary.\n\n## Risks\nA risk.\n\n## Comparison\n[First](https://example.com/a) is faster, whereas [Second](https://example.org/b) is cheaper.";

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

test("ordinary mentions of sections do not create requested headings", () => {
	const report =
		"# Report\n\n[First](https://example.com/a) [Second](https://example.org/b)";
	expect(
		validateReport(report, "Summarize the sections of these pages.", manifest),
	).toEqual([]);
});

test("a following instruction is not absorbed into an explicit heading list", () => {
	const report =
		"# Report\n\n## Summary\nOne.\n\n## Risks\nTwo.\n\n[First](https://example.com/a) is faster, whereas [Second](https://example.org/b) is cheaper.";
	expect(
		validateReport(
			report,
			"Use headings Summary and Risks, then compare the sources.",
			manifest,
		),
	).toEqual([]);
});

test("comparison prose must cite two distinct requested sources outside the coverage appendix", () => {
	const report = appendCoverage(
		"# Report\n\n[First](https://example.com/a) is faster, however that is uncertain.",
		manifest,
	);
	expect(validateReport(report, "Compare the sources.", manifest)).toContain(
		"Missing cross-source comparison.",
	);
});

test("a requested citation with balanced URL parentheses is recognized", () => {
	const withParentheses = createCoverage(
		[{ requestedUrl: "https://example.com/a(b)", status: "ok", text: "A" }],
		[],
		[],
	);
	const report = appendCoverage("# Report\n\nAnalysis.", withParentheses);
	expect(validateReport(report, "Summarize.", withParentheses)).toEqual([]);
});
