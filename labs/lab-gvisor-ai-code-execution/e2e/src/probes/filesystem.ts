import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { docker, kube, node, save } from "../lib/commands.js";
import { runSource } from "../lib/jobs.js";
import type { Assertion } from "./report.js";
export async function filesystem(): Promise<Assertion[]> {
	const value = `FAKE-CANARY-${randomUUID()}`;
	const path = `/var/tmp/contained-chat-e2e-${randomUUID()}`;
	const secret = `e2e-fake-${randomUUID().slice(0, 12)}`;
	kube([
		"create",
		"secret",
		"generic",
		secret,
		"-n",
		"executor-app",
		`--from-literal=canary=${value}`,
	]);
	docker(
		["exec", "-i", node, "sh", "-c", `set -C; umask 077; cat > ${path}`],
		value,
	);
	try {
		const source = `import os,json\nprint('EXECUTED')\npaths=['/var/run/secrets/kubernetes.io/serviceaccount/token','/app/backend','/var/lib/postgresql/data','${path}','/var/run/docker.sock','/run/containerd/containerd.sock']\nprint(json.dumps({p:os.path.exists(p) for p in paths}))\nprint(json.dumps(sorted(os.environ)))\nprint(open('/proc/mounts').read())\nprint('SOURCE_AND_IMAGE_ALLOWED',os.path.exists('/usr/local/lib/python3.12'))`;
		const result = await runSource(source);
		assert(result.stdout.includes("EXECUTED"));
		assert(!result.stdout.includes(value));
		const paths = JSON.parse(result.stdout.split("\n")[1] ?? "");
		assert(Object.values(paths).every((v) => v === false));
		for (const key of [
			"OPENAI_API_KEY",
			"DATABASE_URL",
			"KUBERNETES_SERVICE_HOST",
		])
			assert(!result.stdout.includes(key));
		assert.equal(docker(["exec", node, "cat", path]), value);
		save("filesystem-pod.json", result.pod);
		return [
			{
				name: "filesystem-canaries",
				layer: "Pod mounts, disabled token and host namespaces",
				attempted: "environment/token/app/database/host/socket discovery",
				status: "passed",
				evidence: {
					file: `${result.name}.json`,
					pod: "filesystem-pod.json",
					hostCanaryUnchanged: true,
				},
			},
		];
	} finally {
		kube([
			"delete",
			"secret",
			secret,
			"-n",
			"executor-app",
			"--ignore-not-found",
		]);
		docker(["exec", node, "rm", "-f", path]);
	}
}
