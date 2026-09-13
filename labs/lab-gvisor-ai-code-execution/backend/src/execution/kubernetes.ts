import { isAbsolute } from "node:path";
import { KubeConfig, type V1Job, type V1Pod } from "@kubernetes/client-node";
import { KubeTransport } from "./http.js";
export interface KubernetesApi {
	getJob(name: string): Promise<V1Job | null>;
	createJob(job: V1Job): Promise<V1Job>;
	listPods(name: string): Promise<V1Pod[]>;
	getPod(name: string): Promise<V1Pod | null>;
	readLogs(
		name: string,
		budget: number,
	): Promise<{ data: Buffer; incomplete: boolean }>;
	deleteJob(name: string, uid: string): Promise<void>;
}
export function ownedConfig(path: string, context: string): KubeConfig {
	if (!isAbsolute(path) || !context)
		throw new Error("Explicit absolute owned kubeconfig and context required.");
	const config = new KubeConfig();
	config.loadFromFile(path);
	config.setCurrentContext(context);
	if (!config.getCurrentCluster()) throw new Error("Owned context not found.");
	return config;
}
export function inClusterConfig(): KubeConfig {
	const config = new KubeConfig();
	config.loadFromCluster();
	return config;
}
export class KubernetesError extends Error {
	constructor(public readonly status: number) {
		super(`Kubernetes request failed (${status}).`);
	}
}
export class Kubernetes implements KubernetesApi {
	private readonly transport: KubeTransport;
	constructor(config: KubeConfig) {
		this.transport = new KubeTransport(config);
	}
	private async json<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T | null> {
		const response = await this.transport.request(method, path, body, 1048576);
		if (response.status === 404 && method !== "POST") return null;
		if (response.status < 200 || response.status >= 300)
			throw new KubernetesError(response.status);
		if (response.incomplete)
			throw new Error("Kubernetes response exceeds budget.");
		return JSON.parse(response.data.toString("utf8")) as T;
	}
	async getJob(name: string): Promise<V1Job | null> {
		return this.json(
			"GET",
			`/apis/batch/v1/namespaces/executor/jobs/${encodeURIComponent(name)}`,
		);
	}
	async createJob(job: V1Job): Promise<V1Job> {
		const result = await this.json<V1Job>(
			"POST",
			"/apis/batch/v1/namespaces/executor/jobs",
			job,
		);
		if (!result) throw new Error("Unknown Job create outcome.");
		return result;
	}
	async listPods(name: string): Promise<V1Pod[]> {
		const list = await this.json<{
			items: V1Pod[];
			metadata?: { continue?: string };
		}>(
			"GET",
			`/api/v1/namespaces/executor/pods?limit=100&labelSelector=${encodeURIComponent(`batch.kubernetes.io/job-name=${name}`)}`,
		);
		if (!list || list.metadata?.continue)
			throw new Error("Incomplete Pod listing.");
		return list.items;
	}
	async getPod(name: string): Promise<V1Pod | null> {
		return this.json(
			"GET",
			`/api/v1/namespaces/executor/pods/${encodeURIComponent(name)}`,
		);
	}
	async readLogs(
		name: string,
		budget: number,
	): Promise<{ data: Buffer; incomplete: boolean }> {
		if (budget <= 0) return { data: Buffer.alloc(0), incomplete: true };
		const cap = Math.min(budget, 32768);
		const response = await this.transport.request(
			"GET",
			`/api/v1/namespaces/executor/pods/${encodeURIComponent(name)}/log?container=runner&follow=false&limitBytes=${cap}`,
			undefined,
			cap,
			true,
		);
		if (response.status !== 200)
			throw new Error(`Kubernetes log read failed (${response.status}).`);
		return response;
	}
	async deleteJob(name: string, uid: string): Promise<void> {
		await this.json(
			"DELETE",
			`/apis/batch/v1/namespaces/executor/jobs/${encodeURIComponent(name)}`,
			{
				apiVersion: "v1",
				kind: "DeleteOptions",
				propagationPolicy: "Foreground",
				preconditions: { uid },
			},
		);
	}
}
