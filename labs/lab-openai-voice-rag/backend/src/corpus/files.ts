import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

type Limits = { fileBytes: number; totalBytes: number };
type Document = { filename: string; text: string; hash: string };
function contained(root: string, path: string) {
	const rel = relative(root, path);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
		throw new Error("Document path escapes root");
}
async function walk(
	root: string,
	path: string,
	seen: Set<string>,
): Promise<string[]> {
	const resolved = await realpath(path);
	contained(root, resolved);
	const info = await stat(resolved);
	if (info.isFile())
		return path.toLowerCase().endsWith(".md") ? [resolved] : [];
	if (!info.isDirectory() || seen.has(resolved)) return [];
	seen.add(resolved);
	const paths: string[] = [];
	for (const entry of await readdir(resolved)) {
		paths.push(...(await walk(root, join(resolved, entry), seen)));
	}
	return paths;
}
async function readBounded(path: string, limit: number) {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		if ((await handle.stat()).size > limit)
			throw new Error("Document exceeds file byte limit");
		const buffer = Buffer.alloc(limit + 1);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		if (bytesRead > limit) throw new Error("Document exceeds file byte limit");
		return buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}
export async function readDocuments(
	documentsRoot: string,
	limits: Limits = { fileBytes: 262144, totalBytes: 2097152 },
): Promise<Document[]> {
	if (
		!Number.isSafeInteger(limits.fileBytes) ||
		limits.fileBytes < 1 ||
		!Number.isSafeInteger(limits.totalBytes) ||
		limits.totalBytes < 1
	)
		throw new Error("Invalid file limits");
	const root = await realpath(documentsRoot);
	const paths = [...new Set(await walk(root, root, new Set()))].sort();
	const documents: Document[] = [];
	let total = 0;
	for (const path of paths) {
		const bytes = await readBounded(path, limits.fileBytes);
		total += bytes.length;
		if (total > limits.totalBytes)
			throw new Error("Documents exceed aggregate byte limit");
		documents.push({
			filename: relative(root, path).split(sep).join("/"),
			text: bytes.toString("utf8"),
			hash: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	return documents;
}
