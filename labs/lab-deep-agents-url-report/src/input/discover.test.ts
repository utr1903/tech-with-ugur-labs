import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { discoverInputs } from "./discover.js";

const temporaryDirectories: string[] = [];

async function inputDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "url-report-input-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

test("accepts an empty input directory", async () => {
	const directory = await inputDirectory();

	expect(await discoverInputs("Summarize this topic.", directory)).toEqual({
		requestedUrls: [],
		notes: [],
	});
});

test("accepts a missing input directory", async () => {
	const directory = await inputDirectory();

	expect(
		await discoverInputs("Summarize this topic.", join(directory, "missing")),
	).toEqual({
		requestedUrls: [],
		notes: [],
	});
});

test("removes prompt URL trailing punctuation and preserves first-seen order", async () => {
	const directory = await inputDirectory();

	expect(
		(
			await discoverInputs(
				"Read https://example.com/one, then (https://example.org/two).",
				directory,
			)
		).requestedUrls,
	).toEqual(["https://example.com/one", "https://example.org/two"]);
});

test("deduplicates URLs across the prompt and urls.txt", async () => {
	const directory = await inputDirectory();
	await writeFile(
		join(directory, "urls.txt"),
		"https://example.org/second\nhttps://example.com/first\nhttps://example.net/third\n",
	);

	expect(
		(await discoverInputs("Read https://example.com/first.", directory))
			.requestedUrls,
	).toEqual([
		"https://example.com/first",
		"https://example.org/second",
		"https://example.net/third",
	]);
});

test("returns direct Markdown and text notes in name order without interpreting their URLs", async () => {
	const directory = await inputDirectory();
	await writeFile(
		join(directory, "zeta.txt"),
		"A URL here is background: https://notes.example/page",
	);
	await writeFile(
		join(directory, "alpha.md"),
		"# Comparison criteria\nCost and latency.",
	);
	await writeFile(join(directory, "urls.txt"), "https://example.com/source\n");

	expect(await discoverInputs("Compare the sources.", directory)).toEqual({
		requestedUrls: ["https://example.com/source"],
		notes: [
			{ name: "alpha.md", text: "# Comparison criteria\nCost and latency." },
			{
				name: "zeta.txt",
				text: "A URL here is background: https://notes.example/page",
			},
		],
	});
});

test("skips directories, symlinks, and unsupported extensions", async () => {
	const directory = await inputDirectory();
	const nested = join(directory, "nested");
	await mkdir(nested);
	await writeFile(join(nested, "hidden.md"), "Do not scan nested files.");
	await writeFile(join(directory, "data.json"), "Do not scan JSON.");
	await symlink(join(nested, "hidden.md"), join(directory, "linked.md"));

	expect(await discoverInputs("", directory)).toEqual({
		requestedUrls: [],
		notes: [],
	});
});

test("rejects a direct text file larger than one MiB", async () => {
	const directory = await inputDirectory();
	await writeFile(join(directory, "large.md"), "a".repeat(1024 * 1024 + 1));

	await expect(discoverInputs("", directory)).rejects.toThrow(
		/large\.md.*1 MiB/,
	);
});

test("accepts a direct text file exactly one MiB", async () => {
	const directory = await inputDirectory();
	const text = "a".repeat(1024 * 1024);
	await writeFile(join(directory, "maximum.txt"), text);

	expect(await discoverInputs("", directory)).toEqual({
		requestedUrls: [],
		notes: [{ name: "maximum.txt", text }],
	});
});

test("never reads owner-private x_ Markdown notes", async () => {
	const directory = await inputDirectory();
	await writeFile(join(directory, "x_private.md"), "a".repeat(1024 * 1024 + 1));
	await writeFile(join(directory, "public.md"), "Shared context");

	expect(await discoverInputs("", directory)).toEqual({
		requestedUrls: [],
		notes: [{ name: "public.md", text: "Shared context" }],
	});
});

test.each([
	"Read https://example.org/a(b)",
	"Read [source](https://example.org/a(b)).",
])("preserves balanced URL parentheses in %s", async (instruction) => {
	expect(
		(await discoverInputs(instruction, await inputDirectory())).requestedUrls,
	).toEqual(["https://example.org/a(b)"]);
});

test("preserves exact URL lines including punctuation in urls.txt", async () => {
	const directory = await inputDirectory();
	await writeFile(
		join(directory, "urls.txt"),
		"https://example.org/a(b)\nhttps://example.org/end!\n",
	);
	expect((await discoverInputs("", directory)).requestedUrls).toEqual([
		"https://example.org/a(b)",
		"https://example.org/end!",
	]);
});
