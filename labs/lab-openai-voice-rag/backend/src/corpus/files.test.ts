import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readDocuments } from "./files.js";

const roots: string[] = [];
async function root() {
	const p = await mkdtemp(join(tmpdir(), "corpus-"));
	roots.push(p);
	return p;
}
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
	);
});
test("reads only contained markdown in deterministic path order", async () => {
	const p = await root();
	await mkdir(join(p, "sub"));
	await writeFile(join(p, "sub", "b.md"), "beta");
	await writeFile(join(p, "a.md"), "alpha");
	await writeFile(join(p, "skip.txt"), "ignore");
	expect((await readDocuments(p)).map((d) => d.filename)).toEqual([
		"a.md",
		"sub/b.md",
	]);
});
test("rejects an escaping markdown symlink", async () => {
	const p = await root();
	const other = await root();
	await writeFile(join(other, "secret.md"), "outside");
	await symlink(join(other, "secret.md"), join(p, "escape.md"));
	await expect(readDocuments(p)).rejects.toThrow(/escape/i);
});
test("rejects an escaping directory symlink", async () => {
	const p = await root();
	const other = await root();
	await symlink(other, join(p, "outside"));
	await expect(readDocuments(p)).rejects.toThrow(/escape/i);
});
test("enforces file and aggregate byte limits", async () => {
	const p = await root();
	await writeFile(join(p, "a.md"), "1234");
	await expect(
		readDocuments(p, { fileBytes: 3, totalBytes: 10 }),
	).rejects.toThrow(/file/i);
	await writeFile(join(p, "b.md"), "1234");
	await expect(
		readDocuments(p, { fileBytes: 4, totalBytes: 7 }),
	).rejects.toThrow(/aggregate/i);
});
test("does not ingest a contained symlink target twice", async () => {
	const p = await root();
	await writeFile(join(p, "a.md"), "alpha");
	await symlink(join(p, "a.md"), join(p, "alias.md"));
	expect((await readDocuments(p)).map((d) => d.filename)).toEqual(["a.md"]);
});
