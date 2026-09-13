import { ExecutionError } from "./types.js";

type Queued = { admit: () => void; timer: ReturnType<typeof setTimeout> };
export class ExecutionSlots {
  private active = 0;
  private readonly queue: Queued[] = [];
  async acquire(deadline: number): Promise<() => void> {
    if (deadline <= Date.now()) throw new ExecutionError("timeout");
    if (this.active < 2) {
      this.active++;
      return this.release();
    }
    return new Promise((resolve, reject) => {
      const queued: Queued = {
        admit: () => {
          clearTimeout(queued.timer);
          resolve(this.release());
        },
        timer: setTimeout(() => {
          const index = this.queue.indexOf(queued);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new ExecutionError("timeout"));
        }, deadline - Date.now()),
      };
      this.queue.push(queued);
    });
  }
  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const queued = this.queue.shift();
      if (queued) queued.admit();
      else this.active--;
    };
  }
}
