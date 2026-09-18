import {
  type ChildProcess,
  type SpawnOptions,
  spawn,
} from "node:child_process";

// Every kubectl call names the context and namespace explicitly, so the
// suite never depends on (or changes) your current kube context.
const KUBE_CONTEXT = process.env.KUBE_CONTEXT ?? "kind-ai-code-sandbox";
const NAMESPACE = "code-sandbox";
export const WEB_URL = "http://127.0.0.1:13000";
export const SANDBOX_URL = "http://127.0.0.1:18000";

// kubectl is a host tool (like kind and Docker), not an npm dependency.
const KUBECTL = "kubectl";

export function spawnKubectl(
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  return spawn(
    KUBECTL,
    ["--context", KUBE_CONTEXT, "-n", NAMESPACE, ...args],
    options,
  );
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function kubectl(args: string[], timeoutMs = 240_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawnKubectl(args, { timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d;
    });
    child.stderr?.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function mustKubectl(args: string[]): Promise<string> {
  const result = await kubectl(args);
  if (result.code !== 0)
    throw new Error(
      `kubectl ${args.join(" ")} failed (${result.code}): ${result.stderr}`,
    );
  return result.stdout;
}

export function execInDeployment(
  deployment: string,
  command: string[],
): Promise<CommandResult> {
  return kubectl(["exec", `deploy/${deployment}`, "--", ...command]);
}

export async function restartDeployment(name: string): Promise<void> {
  await mustKubectl(["rollout", "restart", `deployment/${name}`]);
  await mustKubectl([
    "rollout",
    "status",
    `deployment/${name}`,
    "--timeout=240s",
  ]);
}
