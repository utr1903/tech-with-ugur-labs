import type { CoverageManifest } from "./coverage.js";

function requestedHeadings(instruction: string): string[] {
	const match = instruction.match(
		/\b(?:use\s+)?(?:headings|sections)(?:\s+titled)?\s*[:-]?\s+([^.!?\n]+)/i,
	);
	if (!match) return [];
	return match[1]
		.split(/,|\s+and\s+/i)
		.map((heading) => heading.trim().replace(/["'`]/g, ""))
		.filter(Boolean);
}

function citedUrls(report: string): Set<string> {
	const links = report.matchAll(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g);
	return new Set(Array.from(links, (match) => match[1]));
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

function containsComparison(report: string): boolean {
	const body = report
		.replace(/^#{1,6}\s+.+$/gm, "")
		.replace(/\[[^\]]+\]\([^)]*\)/g, "");
	return /\b(whereas|compared|compare|comparison|contrast|versus|vs\.?|while|however)\b/i.test(
		body,
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
	const citations = citedUrls(report);
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
		!containsComparison(report)
	) {
		failures.push("Missing cross-source comparison.");
	}
	return failures;
}
