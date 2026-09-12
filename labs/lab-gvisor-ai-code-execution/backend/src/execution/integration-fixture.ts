import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { KubeConfig } from "@kubernetes/client-node";
import { createPool } from "../database/pool.js";
import { setupDatabase } from "../database/schema.js";
import { createLogger } from "../logger.js";
import { Executor } from "./execute.js";
import { Kubernetes, type KubernetesApi, ownedConfig } from "./kubernetes.js";
export const integration = Boolean(
	process.env.TEST_DATABASE_URL &&
		process.env.LAB_KUBECONFIG &&
		process.env.LAB_KUBE_CONTEXT,
);
export function input(source = "print(42)") {
	return {
		threadId: randomUUID(),
		turnId: randomUUID(),
		toolCallId: randomUUID(),
		source,
	};
}
export function fixture() {
	const config = ownedConfig(
		process.env.LAB_KUBECONFIG ?? "",
		process.env.LAB_KUBE_CONTEXT ?? "",
	);
	const cluster = config.getCurrentCluster();
	const user = config.getCurrentUser();
	const url = process.env.TEST_DATABASE_URL;
	assert(cluster && user && url);
	const narrow = new KubeConfig();
	narrow.loadFromClusterAndUser(cluster, {
		...user,
		impersonateUser: "system:serviceaccount:executor-app:backend",
	});
	const api = new Kubernetes(narrow);
	const pool = createPool(url);
	const logger = createLogger({ appName: "executor-test" });
	logger.level = "silent";
	return {
		api,
		pool,
		logger,
		executor: new Executor(pool, api, logger),
		async setup() {
			await setupDatabase(pool);
			await pool.query("TRUNCATE executions");
		},
	};
}
export async function until<T>(
	read: () => Promise<T>,
	ready: (value: T) => boolean,
	timeout = 15000,
): Promise<T> {
	const end = Date.now() + timeout;
	do {
		const value = await read();
		if (ready(value)) return value;
		await new Promise((r) => setTimeout(r, 100));
	} while (Date.now() < end);
	throw new Error("Integration observation deadline exceeded.");
}

export function override(
	api: KubernetesApi,
	changes: Partial<KubernetesApi>,
): KubernetesApi {
	return {
		getJob: api.getJob.bind(api),
		createJob: api.createJob.bind(api),
		listPods: api.listPods.bind(api),
		getPod: api.getPod.bind(api),
		readLogs: api.readLogs.bind(api),
		deleteJob: api.deleteJob.bind(api),
		...changes,
	};
}
