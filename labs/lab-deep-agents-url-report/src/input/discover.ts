import { constants, type Dirent } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

const MAX_FILE_BYTES = 1024 * 1024;

export interface DiscoveredInputs {
	requestedUrls: string[];
	notes: { name: string; text: string }[];
}

function extractUrls(text: string): string[] {
	const matches = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
	return matches
		.map((match) => match.replace(/[.,;:!?()[\]{}]+$/u, ""))
		.filter((match) => match.length > "https://".length);
}

async function readBoundedText(path: string, name: string): Promise<string> {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stats = await file.stat();
		if (!stats.isFile()) {
			throw new Error(`Input ${name} is not a regular file.`);
		}
		if (stats.size > MAX_FILE_BYTES) {
			throw new Error(`Input ${name} exceeds the 1 MiB file limit.`);
		}

		const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await file.read(
				buffer,
				length,
				buffer.length - length,
				null,
			);
			if (bytesRead === 0) break;
			length += bytesRead;
		}
		if (length > MAX_FILE_BYTES) {
			throw new Error(`Input ${name} exceeds the 1 MiB file limit.`);
		}
		return buffer.toString("utf8", 0, length);
	} finally {
		await file.close();
	}
}

export async function discoverInputs(
	instruction: string,
	inputDir: string,
): Promise<DiscoveredInputs> {
	const requestedUrls = new Set(extractUrls(instruction));
	const notes: DiscoveredInputs["notes"] = [];
	let entries: Dirent[];
	try {
		entries = await readdir(inputDir, { withFileTypes: true });
	} catch (err) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") {
			return { requestedUrls: [...requestedUrls], notes };
		}
		throw err;
	}

	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (!entry.isFile() || !/\.(md|txt)$/iu.test(entry.name)) continue;
		const text = await readBoundedText(join(inputDir, entry.name), entry.name);
		if (entry.name === "urls.txt") {
			for (const url of extractUrls(text)) requestedUrls.add(url);
		} else {
			notes.push({ name: entry.name, text });
		}
	}
	return { requestedUrls: [...requestedUrls], notes };
}
