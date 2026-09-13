import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const lab = fileURLToPath(new URL("../../../", import.meta.url));
export const cluster =
	process.env.GVISOR_CLUSTER_NAME ?? "gvisor-code-execution";
export const context = `kind-${cluster}`;
export const kubeconfig = process.env.GVISOR_KUBECONFIG ?? "";
const dockerContext = process.env.GVISOR_DOCKER_CONTEXT ?? "";
export const evidence = process.env.GVISOR_EVIDENCE_DIR ?? "";
export const node = `${cluster}-control-plane`;
export function initialize() {
	assert(/^[a-z0-9][a-z0-9-]{1,55}$/.test(cluster));
	assert(
		isAbsolute(kubeconfig) && isAbsolute(evidence) && dockerContext,
		"Explicit kubeconfig, Docker context and absolute evidence directory required.",
	);
	assert(
		!resolve(evidence).startsWith(resolve(lab)),
		"Keep verification artifacts outside checkout.",
	);
	mkdirSync(evidence, { recursive: true, mode: 0o700 });
	assert.equal(
		docker([
			"inspect",
			node,
			"--format",
			'{{index .Config.Labels "io.x-k8s.kind.cluster"}}',
		]).trim(),
		cluster,
	);
}
export function command(
	executable: string,
	args: string[],
	input?: string,
): string {
	return execFileSync(executable, args, {
		encoding: "utf8",
		input,
		maxBuffer: 8 * 1024 * 1024,
		timeout: 360000,
		stdio: ["pipe", "pipe", "pipe"],
	});
}
export function kube(args: string[], input?: string) {
	return command(
		"kubectl",
		["--kubeconfig", kubeconfig, "--context", context, ...args],
		input,
	);
}
export function docker(args: string[], input?: string) {
	return command("docker", ["--context", dockerContext, ...args], input);
}
export function save(name: string, data: unknown) {
	writeFileSync(
		resolve(evidence, name),
		typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`,
		{ mode: 0o600 },
	);
	return resolve(evidence, name);
}
export function json<T>(args: string[]): T {
	return JSON.parse(kube([...args, "-o", "json"])) as T;
}
export const pause = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));
export function runnerTemplate() {
	return JSON.parse(
		readFileSync(resolve(lab, "runtime/runner-job.json"), "utf8"),
	);
}
