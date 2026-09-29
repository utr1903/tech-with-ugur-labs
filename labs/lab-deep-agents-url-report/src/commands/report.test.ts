import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import type { AgentInput, AgentOutput } from "../research/types.js";
import { runReport } from "./report.js";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories)
		await rm(directory, { recursive: true, force: true });
});
async function workspace() {
	const directory = await mkdtemp(join(tmpdir(), "url-report-"));
	directories.push(directory);
	await mkdir(join(directory, "input"));
	return directory;
}
const logger = pino({ enabled: false });
const success = (requestedUrl: string) => ({
	requestedUrl,
	finalUrl: requestedUrl,
	status: "ok" as const,
	text: "Page facts",
});

test("prompt-only mode writes report and ordered coverage artifacts", async () => {
	const directory = await workspace();
	const url = "https://example.com/a";
	await runReport(`Summarize ${url}`, {
		workspaceDir: directory,
		apiKey: "test-key",
		logger,
		draft: async (input: AgentInput): Promise<AgentOutput> => {
			expect(input.requestedUrls).toEqual([url]);
			expect(input.notes).toEqual([]);
			expect(input.model).toBe("gpt-6-sol");
			return {
				report: `# Summary\n\nSee [source](${url}).`,
				results: [success(url)],
				supplemental: [],
				events: [{ tool: "read_url", input: url, status: "ok" }],
			};
		},
	});
	expect(await readFile(join(directory, "output/report.md"), "utf8")).toContain(
		"## Source coverage",
	);
	expect(
		JSON.parse(await readFile(join(directory, "output/coverage.json"), "utf8")),
	).toMatchObject({
		status: "complete",
		requestedCount: 1,
		events: [{ tool: "read_url", input: url, status: "ok" }],
	});
});

test("file mode passes urls.txt and note content to the drafter", async () => {
	const directory = await workspace();
	await writeFile(
		join(directory, "input/urls.txt"),
		"https://example.com/file\n",
	);
	await writeFile(join(directory, "input/context.md"), "Local context");
	await expect(
		runReport("Summarize sources", {
			workspaceDir: directory,
			apiKey: "test-key",
			logger,
			draft: async (input) => {
				expect(input.requestedUrls).toEqual(["https://example.com/file"]);
				expect(input.notes).toEqual([
					{ name: "context.md", text: "Local context" },
				]);
				return {
					report: "# Summary",
					results: [
						{
							requestedUrl: input.requestedUrls[0],
							status: "failed",
							error: "timeout",
						},
					],
					supplemental: [],
					events: [
						{
							tool: "read_url",
							input: input.requestedUrls[0],
							status: "failed",
							error: "timeout",
						},
					],
				};
			},
		}),
	).rejects.toThrow(/failed requested URL/i);
	expect(await readFile(join(directory, "output/report.md"), "utf8")).toContain(
		"Failed: timeout",
	);
});

test("failed requested URL persists partial report and manifest before failing", async () => {
	const directory = await workspace();
	const url = "https://example.com/down";
	await expect(
		runReport(`Summarize ${url}`, {
			workspaceDir: directory,
			apiKey: "test-key",
			logger,
			draft: async () => ({
				report: "# Summary",
				results: [{ requestedUrl: url, status: "failed", error: "timeout" }],
				supplemental: [],
				events: [
					{ tool: "read_url", input: url, status: "failed", error: "timeout" },
				],
			}),
		}),
	).rejects.toThrow(/failed requested URL/i);
	expect(await readFile(join(directory, "output/report.md"), "utf8")).toContain(
		"Failed: timeout",
	);
	expect(
		JSON.parse(await readFile(join(directory, "output/coverage.json"), "utf8")),
	).toMatchObject({ status: "partial", failedCount: 1 });
});

test("missing API key fails before drafting", async () => {
	const directory = await workspace();
	const draft = vi.fn();
	await expect(
		runReport("Summarize", {
			workspaceDir: directory,
			apiKey: "",
			logger,
			draft,
		}),
	).rejects.toThrow(/OPENAI_API_KEY/);
	expect(draft).not.toHaveBeenCalled();
});

test("validation checks final report but coverage appendix cannot satisfy comparison", async () => {
	const directory = await workspace();
	const a = "https://example.com/a";
	const b = "https://example.com/b";
	await expect(
		runReport(`Compare ${a} and ${b}; use headings: Findings`, {
			workspaceDir: directory,
			apiKey: "test-key",
			logger,
			draft: async () => ({
				report: "# Findings\n\nTwo pages were read.",
				results: [success(a), success(b)],
				supplemental: [{ url: "https://example.com/search", title: "Search" }],
				events: [
					{ tool: "read_url", input: a, status: "ok" },
					{ tool: "read_url", input: b, status: "ok" },
					{ tool: "web_search_call", input: "Compare", status: "ok" },
				],
			}),
		}),
	).rejects.toThrow(/Missing cross-source comparison/);
	const report = await readFile(join(directory, "output/report.md"), "utf8");
	const coverage = JSON.parse(
		await readFile(join(directory, "output/coverage.json"), "utf8"),
	);
	expect(report).toContain("https://example.com/search");
	expect(coverage).toMatchObject({
		status: "partial",
		requestedCount: 2,
		supplemental: [{ url: "https://example.com/search" }],
		events: [
			{ tool: "read_url" },
			{ tool: "read_url" },
			{ tool: "web_search_call" },
		],
	});
});

test("empty draft remains a validation failure after appending coverage", async () => {
	const directory = await workspace();
	await expect(
		runReport("Summarize", {
			workspaceDir: directory,
			apiKey: "test-key",
			logger,
			draft: async () => ({
				report: "",
				results: [],
				supplemental: [],
				events: [],
			}),
		}),
	).rejects.toThrow(/Report is empty/);
	expect(
		JSON.parse(await readFile(join(directory, "output/coverage.json"), "utf8")),
	).toMatchObject({ status: "partial", requestedCount: 0 });
});
