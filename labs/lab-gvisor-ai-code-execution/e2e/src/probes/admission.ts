import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
	cluster,
	command,
	docker,
	evidence,
	kubeconfig,
	lab,
	node,
	runnerTemplate,
	save,
} from "../lib/commands.js";
import type { Assertion } from "./report.js";
export function admission(): Assertion[] {
	const image = runnerTemplate().spec.template.spec.containers[0].image;
	const log = command("env", [
		`GVISOR_KUBECONFIG=${kubeconfig}`,
		`GVISOR_CLUSTER_NAME=${cluster}`,
		`GVISOR_RUNNER_IMAGE=${image}`,
		"bash",
		resolve(lab, "runtime/executor-policy-smoke.sh"),
	]);
	save("admission.log", log);
	const config = docker(["exec", node, "cat", "/var/lib/kubelet/config.yaml"]);
	save("kubelet-config.yaml", config);
	assert(/containerLogMaxSize: 1Mi/.test(config));
	assert(/containerLogMaxFiles: 2/.test(config));
	return [
		{
			name: "fixed-admission-rbac-log-retention",
			layer: "admission/RBAC/kubelet",
			attempted: "invalid Job/Pod fields and forbidden backend API operations",
			status: "passed",
			evidence: {
				directory: evidence,
				files: ["admission.log", "kubelet-config.yaml"],
			},
		},
	];
}
