import { readFileSync } from "node:fs";
import { Client } from "ssh2";

export function execOverSsh({
	port,
	privateKeyPath,
	command,
	timeoutMs,
}: {
	port: number;
	privateKeyPath: string;
	command: string;
	timeoutMs: number;
}): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const connection = new Client();
		const timer = setTimeout(() => {
			connection.end();
			reject(
				new Error(`SSH command timed out after ${timeoutMs}ms: ${command}`),
			);
		}, timeoutMs);

		connection
			.on("ready", () => {
				connection.exec(command, (err, stream) => {
					if (err) {
						clearTimeout(timer);
						connection.end();
						reject(err);
						return;
					}
					let stdout = "";
					let stderr = "";
					// @types/ssh2 1.15.5 types "close" with no arguments (it only
					// signals the channel is fully closed); the exit code arrives
					// separately via the "exit" event, so capture it there.
					let exitCode: number | null = null;
					stream
						.on("exit", (code: number) => {
							exitCode = code;
						})
						.on("data", (chunk: Buffer) => {
							stdout += chunk.toString();
						})
						.on("close", () => {
							clearTimeout(timer);
							connection.end();
							resolve({ code: exitCode ?? -1, stdout, stderr });
						});
					stream.stderr.on("data", (chunk: Buffer) => {
						stderr += chunk.toString();
					});
				});
			})
			.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			})
			.connect({
				host: "127.0.0.1",
				port,
				username: "ubuntu",
				privateKey: readFileSync(privateKeyPath),
				readyTimeout: 15000,
			});
	});
}
