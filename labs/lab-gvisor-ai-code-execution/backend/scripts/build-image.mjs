import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../", import.meta.url));
const staged = new URL("../.build/runner-job.json", import.meta.url);
const source = new URL("../../runtime/runner-job.json", import.meta.url);
mkdirSync(new URL("../.build", import.meta.url), { recursive: true });
copyFileSync(source, staged);
if (
	createHash("sha256").update(readFileSync(source)).digest("hex") !==
	createHash("sha256").update(readFileSync(staged)).digest("hex")
)
	throw new Error("Runner template staging failed.");
if (!process.argv.includes("--prepare-only")) {
	const result = spawnSync(
		"docker",
		[
			"--context",
			process.env.LAB_DOCKER_CONTEXT ?? "default",
			"build",
			"--tag",
			process.env.BACKEND_IMAGE ?? "twu-chat-backend:local",
			app,
		],
		{ stdio: "inherit" },
	);
	rmSync(new URL("../.build", import.meta.url), {
		recursive: true,
		force: true,
	});
	process.exit(result.status ?? 1);
}
