import { setTimeout as pause } from "node:timers/promises";
import {
  ApiException,
  type BatchV1Api,
  type ConfigurationOptions,
  createConfiguration,
} from "@kubernetes/client-node";
import { ExecutionError, type JobClient } from "../execution/types.js";
import { operation } from "../lib/operation.js";
import type { Logger } from "../logger.js";
import { buildJob, type JobConfig } from "./template.js";

function requestOptions(deadline: number): ConfigurationOptions {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ExecutionError("timeout");
  return {
    middleware: createConfiguration({
      promiseMiddleware: [
        {
          pre: async (context) => {
            context.setSignal(AbortSignal.timeout(Math.max(1, remaining)));
            return context;
          },
          post: async (context) => context,
        },
      ],
    }).middleware,
    middlewareMergeStrategy: "append",
  };
}
function missing(err: unknown): boolean {
  return err instanceof ApiException && err.code === 404;
}

export class KubernetesJobClient implements JobClient {
  constructor(
    private readonly api: BatchV1Api,
    private readonly config: JobConfig,
    private readonly logger: Logger,
    private readonly interval = 250,
  ) {}
  async create(
    id: string,
    message: string,
    deadline = Date.now() + 10000,
  ): Promise<void> {
    await operation(this.logger, "Create Job", { id }, async () => {
      try {
        await this.api.createNamespacedJob(
          {
            namespace: this.config.namespace,
            body: buildJob(this.config, id, message),
          },
          requestOptions(deadline),
        );
      } catch (err) {
        if (Date.now() >= deadline) throw new ExecutionError("timeout");
        throw err;
      }
    });
  }
  async wait(id: string, deadline: number): Promise<void> {
    await operation(this.logger, "Wait Job", { id }, async () => {
      for (;;) {
        const job = await this.get(id, deadline);
        const conditions = job.status?.conditions ?? [];
        const failed = conditions.find(
          (condition) =>
            condition.type === "Failed" && condition.status === "True",
        );
        if (failed)
          throw new ExecutionError(
            failed.reason === "DeadlineExceeded" ? "timeout" : "infrastructure",
          );
        if (
          conditions.some(
            (condition) =>
              condition.type === "Complete" && condition.status === "True",
          )
        )
          return;
        await this.delay(deadline);
      }
    });
  }
  async remove(id: string, deadline = Date.now() + 5000): Promise<void> {
    await operation(this.logger, "Remove Job", { id }, async () => {
      try {
        await this.api.deleteNamespacedJob(
          {
            name: `execution-${id}`,
            namespace: this.config.namespace,
            propagationPolicy: "Foreground",
            gracePeriodSeconds: 0,
          },
          requestOptions(deadline),
        );
      } catch (err) {
        if (missing(err)) return;
        throw err;
      }
      for (;;) {
        try {
          await this.get(id, deadline);
        } catch (err) {
          if (err instanceof ApiException && err.code === 404) return;
          throw err;
        }
        await this.delay(deadline);
      }
    });
  }
  private async get(id: string, deadline: number) {
    try {
      return await this.api.readNamespacedJob(
        { name: `execution-${id}`, namespace: this.config.namespace },
        requestOptions(deadline),
      );
    } catch (err) {
      if (Date.now() >= deadline) throw new ExecutionError("timeout");
      throw err;
    }
  }
  private async delay(deadline: number): Promise<void> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ExecutionError("timeout");
    await pause(Math.min(this.interval, remaining));
  }
}
