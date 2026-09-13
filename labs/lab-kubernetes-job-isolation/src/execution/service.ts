import { randomUUID } from "node:crypto";
import { operation } from "../lib/operation.js";
import type { Logger } from "../logger.js";
import { CompletedExecutions } from "./retention.js";
import { ExecutionSlots } from "./slots.js";
import {
  ExecutionError,
  type ExecutionResult,
  type ExecutionService,
  type ExecutionStore,
  type JobClient,
} from "./types.js";

type Options = { requestTimeoutMs: number; cleanupReserveMs: number };
async function bounded<T>(task: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ExecutionError("timeout")),
          Math.max(0, deadline - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class KubernetesExecutionService implements ExecutionService {
  private readonly slots = new ExecutionSlots();
  private readonly retained = new CompletedExecutions();
  private readonly uncertain = new Set<string>();
  constructor(
    private readonly store: ExecutionStore,
    private readonly jobs: JobClient,
    private readonly logger: Logger,
    private readonly options: Options = {
      requestTimeoutMs: 60000,
      cleanupReserveMs: 5000,
    },
  ) {}
  async execute(message: string): Promise<ExecutionResult> {
    const deadline = Date.now() + this.options.requestTimeoutMs;
    const runDeadline = deadline - this.options.cleanupReserveMs;
    return operation(
      this.logger,
      "Execute command",
      {},
      async () => {
        const release = await this.slots.acquire(runDeadline);
        try {
          await bounded(this.reconcile(deadline), runDeadline);
          await bounded(
            this.retained.prune((id) => this.cleanup(id, deadline)),
            runDeadline,
          );
          return await this.run(message, runDeadline, deadline);
        } finally {
          release();
        }
      },
      (result) => ({ id: result.id, exitCode: result.exitCode }),
    );
  }
  async sweep(): Promise<void> {
    await operation(this.logger, "Sweep completed executions", {}, () =>
      this.retained.prune(
        (id) => this.cleanup(id, Date.now() + 5000),
        Date.now(),
        0,
      ),
    );
  }
  private async run(
    message: string,
    runDeadline: number,
    deadline: number,
  ): Promise<ExecutionResult> {
    const id = randomUUID();
    let prepared = false;
    let submitted = false;
    try {
      if (Date.now() >= runDeadline) throw new ExecutionError("timeout");
      await this.store.prepare(id);
      prepared = true;
      submitted = true;
      await bounded(this.jobs.create(id, message, runDeadline), runDeadline);
      await bounded(this.jobs.wait(id, runDeadline), runDeadline);
      const result = await bounded(this.store.read(id), runDeadline);
      this.retained.add(id);
      await this.retained.prune(
        (old) => this.cleanup(old, deadline),
        Date.now(),
        0,
      );
      return result;
    } catch (err) {
      if (submitted) this.uncertain.add(id);
      if (prepared) await this.cleanup(id, deadline);
      throw err;
    }
  }
  private async cleanup(id: string, deadline: number): Promise<void> {
    await operation(this.logger, "Clean execution", { id }, async () => {
      await bounded(this.jobs.remove(id, deadline), deadline);
      await this.store.remove(id);
      this.uncertain.delete(id);
      this.retained.forget(id);
    });
  }
  private async reconcile(deadline: number): Promise<void> {
    for (const id of this.uncertain) await this.cleanup(id, deadline);
  }
}
