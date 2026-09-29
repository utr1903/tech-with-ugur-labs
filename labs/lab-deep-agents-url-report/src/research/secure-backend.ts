import { FilesystemBackend } from "deepagents";

export class InputSafeBackend extends FilesystemBackend {
	override async grep(
		_pattern: string,
		_dirPath = "/",
		_glob: string | null = null,
		_maxCount: number | null = null,
	) {
		return { matches: [], error: "Files are not searchable." };
	}
}
