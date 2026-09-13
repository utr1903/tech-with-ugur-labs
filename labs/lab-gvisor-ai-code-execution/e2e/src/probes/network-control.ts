import { kube, runnerTemplate } from "../lib/commands.js";
export const namespace = "contained-chat-e2e-policy";
export function ordinary(source: string) {
	return kube([
		"exec",
		"-n",
		namespace,
		"control",
		"--",
		"python",
		"-I",
		"-u",
		"-c",
		source,
	]);
}
export function setupControl() {
	kube(
		["create", "-f", "-"],
		JSON.stringify({
			apiVersion: "v1",
			kind: "Pod",
			metadata: { name: "control", namespace },
			spec: {
				automountServiceAccountToken: false,
				containers: [
					{
						name: "python",
						image: runnerTemplate().spec.template.spec.containers[0].image,
						imagePullPolicy: "Never",
						command: ["python", "-c", "import time;time.sleep(3600)"],
					},
				],
			},
		}),
	);
	kube([
		"wait",
		"pod/control",
		"-n",
		namespace,
		"--for=condition=Ready",
		"--timeout=90s",
	]);
}
export function policy(enabled: boolean) {
	if (!enabled) {
		kube([
			"delete",
			"networkpolicy",
			"default-deny",
			"-n",
			namespace,
			"--ignore-not-found",
		]);
		return;
	}
	kube(
		["apply", "-f", "-"],
		JSON.stringify({
			apiVersion: "networking.k8s.io/v1",
			kind: "NetworkPolicy",
			metadata: { name: "default-deny", namespace },
			spec: {
				podSelector: {},
				policyTypes: ["Ingress", "Egress"],
				ingress: [],
				egress: [],
			},
		}),
	);
}
