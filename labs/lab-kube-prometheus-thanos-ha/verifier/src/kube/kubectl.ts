import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "../logger.js";

export type ExecFn = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string }>;

const defaultExec: ExecFn = async (cmd, args) => {
  const { stdout } = await promisify(execFile)(cmd, args);
  return { stdout };
};

export class Kubectl {
  private readonly logger: Logger;
  private readonly execFn: ExecFn;

  constructor({ logger, execFn }: { logger: Logger; execFn?: ExecFn }) {
    this.logger = logger.child({ domain: "kubectl" });
    this.execFn = execFn ?? defaultExec;
  }

  async deletePod(namespace: string, pod: string): Promise<void> {
    try {
      this.logger.info({ namespace, pod }, "Deleting pod...");
      await this.execFn("kubectl", [
        "delete",
        "pod",
        pod,
        "-n",
        namespace,
        "--wait=false",
      ]);
      this.logger.info({ namespace, pod }, "Deleting pod succeeded.");
    } catch (err) {
      this.logger.error({ err, namespace, pod }, "Deleting pod failed.");
      throw err;
    }
  }

  // False also covers "pod currently absent" (deleted, not yet recreated).
  async isPodReady(namespace: string, pod: string): Promise<boolean> {
    try {
      const { stdout } = await this.execFn("kubectl", [
        "get",
        "pod",
        pod,
        "-n",
        namespace,
        "-o",
        'jsonpath={.status.conditions[?(@.type=="Ready")].status}',
      ]);
      return stdout.trim() === "True";
    } catch {
      return false;
    }
  }

  async waitPodReady(
    namespace: string,
    pod: string,
    timeoutSeconds: number,
  ): Promise<void> {
    try {
      this.logger.info(
        { namespace, pod, timeoutSeconds },
        "Waiting for pod Ready...",
      );
      await this.execFn("kubectl", [
        "wait",
        "--for=condition=Ready",
        `pod/${pod}`,
        "-n",
        namespace,
        `--timeout=${timeoutSeconds}s`,
      ]);
      this.logger.info({ namespace, pod }, "Waiting for pod Ready succeeded.");
    } catch (err) {
      this.logger.error(
        { err, namespace, pod },
        "Waiting for pod Ready failed.",
      );
      throw err;
    }
  }

  async podNamesByLabel(
    namespace: string,
    selector: string,
  ): Promise<string[]> {
    try {
      const { stdout } = await this.execFn("kubectl", [
        "get",
        "pods",
        "-n",
        namespace,
        "-l",
        selector,
        "-o",
        "jsonpath={.items[*].metadata.name}",
      ]);
      return stdout
        .trim()
        .split(/\s+/)
        .filter((n) => n.length > 0);
    } catch (err) {
      this.logger.error(
        { err, namespace, selector },
        "Listing pods by label failed.",
      );
      throw err;
    }
  }

  async waitDeploymentReady(
    namespace: string,
    name: string,
    timeoutSeconds: number,
  ): Promise<void> {
    try {
      this.logger.info(
        { namespace, name, timeoutSeconds },
        "Waiting for deployment rollout...",
      );
      await this.execFn("kubectl", [
        "rollout",
        "status",
        `deployment/${name}`,
        "-n",
        namespace,
        `--timeout=${timeoutSeconds}s`,
      ]);
      this.logger.info(
        { namespace, name },
        "Waiting for deployment rollout succeeded.",
      );
    } catch (err) {
      this.logger.error(
        { err, namespace, name },
        "Waiting for deployment rollout failed.",
      );
      throw err;
    }
  }
}
