import { isAbsolute } from "node:path";
import { ExecutionError } from "./execution/types.js";
import type { JobConfig } from "./kubernetes/template.js";

export function readConfig(
  env: NodeJS.ProcessEnv = process.env,
): JobConfig & { port: number; root: string } {
  const namespace = env.NAMESPACE;
  const image = env.WORKER_IMAGE;
  const pvcName = env.PVC_NAME;
  const secure = env.SECURE_MODE ?? "false";
  const port = Number(env.PORT ?? "3000");
  const root = env.DATA_ROOT ?? "/data";
  if (!namespace || !image || !pvcName)
    throw new ExecutionError("infrastructure");
  if (secure !== "true" && secure !== "false")
    throw new ExecutionError("infrastructure");
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !isAbsolute(root))
    throw new ExecutionError("infrastructure");
  return { namespace, image, pvcName, secure: secure === "true", port, root };
}
