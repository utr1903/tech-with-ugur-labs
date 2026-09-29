import type { CoverageManifest } from "./coverage.js";

function requestedHeadings(instruction: string): string[] {
	const match = instruction.match(
		/\b(?:use\s+(?:the\s+)?(?:headings|sections)|(?:headings|sections)\s*:|(?:headings|sections)\s+(?:titled|named|called))\s*:?[ \t]+([^.!?\n]+)/i,
	);
	if (!match) return [];
	const list = match[1].split(
		/,\s*(?:and\s+)?then\b|;|\s+and\s+(?=compare|summarize|discuss)\b/i,
	)[0];
	return list
		.split(/,|\s+and\s+/i)
		.map((heading) => heading.trim().replace(/["'`]/g, ""))
		.filter(Boolean);
}

function linkDestination(report: string, start: number): string | undefined {
	let depth = 1;
	for (let index = start; index < report.length; index++) {
		if (report[index] === "(") depth++;
		if (report[index] === ")") depth--;
		if (depth === 0) return report.slice(start, index);
	}
	return undefined;
}

function citedUrls(report: string): Set<string> {
	const urls = new Set<string>();
	for (const match of report.matchAll(/\[[^\]]+\]\(/g)) {
		const destination = linkDestination(
			report,
			(match.index ?? 0) + match[0].length,
		);
		if (destination && /^https?:\/\//i.test(destination)) urls.add(destination);
	}
	return urls;
}

function disclosesFailure(report: string, url: string): boolean {
	return report
		.split("\n")
		.some(
			(line) =>
				line.includes(url) &&
				/\b(fail(?:ed|ure)?|error|could not|unavailable)\b/i.test(line),
		);
}

function containsComparison(
	report: string,
	manifest: CoverageManifest,
): boolean {
	const appendix = report.search(/^## Source coverage\s*$/m);
	const draft = appendix < 0 ? report : report.slice(0, appendix);
	const requested = new Set(
		manifest.requested
			.filter((entry) => entry.status === "ok")
			.map((entry) => entry.requestedUrl),
	);
	const comparative =
		/\b(whereas|compared|compare|comparison|contrast|versus|vs\.?|while|however)\b/i;
	const citedCount = (text: string) =>
		[...citedUrls(text)].filter((url) => requested.has(url)).length;
	if (
		draft
			.split(/\n\s*\n/)
			.some(
				(paragraph) =>
					comparative.test(paragraph) && citedCount(paragraph) >= 2,
			)
	)
		return true;
	const section = draft.match(
		/^#{1,6}\s+(?:compar(?:ison|ative analysis)|contrast)\s*\n([\s\S]*?)(?=^#{1,6}\s+|$(?![\s\S]))/im,
	)?.[1];
	return Boolean(
		section && comparative.test(section) && citedCount(draft) >= 2,
	);
}

export function validateReport(
	report: string,
	instruction: string,
	manifest: CoverageManifest,
): string[] {
	const failures: string[] = [];
	if (!report.trim()) failures.push("Report is empty.");
	const headings = new Set(
		Array.from(report.matchAll(/^#{1,6}\s+(.+?)\s*$/gm), (match) =>
			match[1].trim().toLowerCase(),
		),
	);
	for (const heading of requestedHeadings(instruction)) {
		if (!headings.has(heading.toLowerCase()))
			failures.push(`Missing requested heading: ${heading}`);
	}
	const citations = citedUrls(report.split(/^## Source coverage\s*$/m)[0]);
	for (const entry of manifest.requested) {
		if (entry.status === "ok" && !citations.has(entry.requestedUrl)) {
			failures.push(`Missing requested source citation: ${entry.requestedUrl}`);
		}
		if (entry.status === "failed") {
			if (!disclosesFailure(report, entry.requestedUrl))
				failures.push(`Missing failure disclosure: ${entry.requestedUrl}`);
		}
	}
	if (
		/\b(compare|comparison|contrast|versus|vs\.?)\b/i.test(instruction) &&
		!containsComparison(report, manifest)
	) {
		failures.push("Missing cross-source comparison.");
	}
	return failures;
}
