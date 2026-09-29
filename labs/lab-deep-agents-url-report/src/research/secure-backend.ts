import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { FilesystemBackend } from "deepagents";

export class InputSafeBackend extends FilesystemBackend {
	constructor(
		rootDir: string,
		private readonly inputFiles: Set<string>,
	) {
		super({ rootDir, virtualMode: true });
	}

	override async read(filePath: string, offset = 0, limit = 500) {
		const segments = filePath.split("/");
		const sensitive = segments.some((name) =>
			/^(?:x_.*\.md|\.env(?:\..*\.local|\.local)?)$/iu.test(name),
		);
		const approvedInput = this.inputFiles.has(filePath);
		const output = filePath.startsWith("/output/");
		if (sensitive || (!approvedInput && !output)) {
			return { error: "File read denied." };
		}
		try {
			const root = await realpath(this.cwd);
			const expected = resolve(root, `.${filePath}`);
			if ((await realpath(expected)) !== expected)
				return { error: "File read denied." };
		} catch {
			return { error: "File read denied or file unavailable." };
		}
		return super.read(filePath, offset, limit);
	}

	override async grep(
		_pattern: string,
		_dirPath = "/",
		_glob: string | null = null,
		_maxCount: number | null = null,
	) {
		return { matches: [], error: "Files are not searchable." };
	}
}
