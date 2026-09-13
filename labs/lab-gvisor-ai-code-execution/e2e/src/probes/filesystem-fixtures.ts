import { randomUUID } from "node:crypto";
import { docker, json, kube, node } from "../lib/commands.js";
export function canaryFixtures() {
	const id = randomUUID().replaceAll("-", "");
	const path = `/tmp/e2e-fake-${id}`;
	const hostPath = `/var/tmp/e2e-fake-${id}`;
	const secret = `e2e-fake-${id}`;
	const table = `e2e_fake_${id}`;
	const values = Object.fromEntries(
		["app", "database", "secret", "host"].map((k) => [
			k,
			`FAKE-${k}-${randomUUID()}`,
		]),
	) as Record<string, string>;
	const backendPod = () => {
		const found = json<{
			items: { metadata: { name: string; uid: string } }[];
		}>(["get", "pods", "-n", "executor-app", "-l", "app=chat-backend"]).items[0]
			?.metadata;
		if (!found) throw new Error("Backend Pod missing.");
		return found;
	};
	let pod = backendPod();
	const exec = (args: string[], input?: string) =>
		kube(["exec", "-i", pod.name, "-n", "executor-app", "--", ...args], input);
	const sql = (query: string) =>
		kube(
			[
				"exec",
				"-i",
				"deployment/chat-postgres",
				"-n",
				"executor-app",
				"--",
				"psql",
				"-X",
				"-U",
				"chat",
				"-d",
				"chat",
				"-v",
				"ON_ERROR_STOP=1",
				"-At",
			],
			query,
		).trim();
	const cleanups: (() => void)[] = [];
	return {
		values,
		path,
		hostPath,
		secret,
		table,
		get pod() {
			return pod;
		},
		seed() {
			pod = backendPod();
			kube([
				"create",
				"secret",
				"generic",
				secret,
				"-n",
				"executor-app",
				`--from-literal=canary=${values.secret}`,
			]);
			cleanups.push(() =>
				kube([
					"delete",
					"secret",
					secret,
					"-n",
					"executor-app",
					"--ignore-not-found",
				]),
			);
			exec(
				[
					"node",
					"-e",
					"require('fs').writeFileSync(process.argv[1],require('fs').readFileSync(0),{flag:'wx',mode:384})",
					path,
				],
				values.app,
			);
			cleanups.push(() =>
				exec([
					"node",
					"-e",
					"require('fs').rmSync(process.argv[1],{force:true})",
					path,
				]),
			);
			sql(
				`CREATE TABLE ${table}(id integer PRIMARY KEY, value text NOT NULL);`,
			);
			cleanups.push(() => sql(`DROP TABLE ${table};`));
			sql(`INSERT INTO ${table} VALUES (1,'${values.database}');`);
			docker(
				[
					"exec",
					"-i",
					node,
					"sh",
					"-c",
					`set -C; umask 077; cat > ${hostPath}`,
				],
				values.host,
			);
			cleanups.push(() => docker(["exec", node, "rm", "-f", hostPath]));
		},
		read() {
			const current = json<{ metadata: { uid: string } }>([
				"get",
				"pod",
				pod.name,
				"-n",
				"executor-app",
			]);
			if (current.metadata.uid !== pod.uid)
				throw new Error("Canary backend Pod changed.");
			return {
				app: exec([
					"node",
					"-e",
					"process.stdout.write(require('fs').readFileSync(process.argv[1]))",
					path,
				]),
				database: sql(`SELECT value FROM ${table} WHERE id=1;`),
				secret: Buffer.from(
					kube([
						"get",
						"secret",
						secret,
						"-n",
						"executor-app",
						"-o",
						"jsonpath={.data.canary}",
					]),
					"base64",
				).toString(),
				host: docker(["exec", node, "cat", hostPath]),
			};
		},
		cleanup() {
			if (!cleanups.length) return;
			const failures: unknown[] = [];
			for (const cleanup of cleanups.reverse()) {
				try {
					cleanup();
				} catch (err) {
					failures.push(err);
				}
			}
			if (failures.length)
				throw new AggregateError(
					failures,
					"Exact fake fixture cleanup failed.",
				);
			if (sql(`SELECT to_regclass('${table}') IS NULL;`) !== "t")
				throw new Error("Fake database table remains.");
			if (
				kube([
					"get",
					"secret",
					secret,
					"-n",
					"executor-app",
					"--ignore-not-found",
					"-o",
					"name",
				]).trim()
			)
				throw new Error("Fake Secret remains.");
			exec([
				"node",
				"-e",
				"if(require('fs').existsSync(process.argv[1]))process.exit(1)",
				path,
			]);
			docker(["exec", node, "test", "!", "-e", hostPath]);
		},
	};
}
