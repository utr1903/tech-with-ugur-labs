// Track only completions known to this server lifespan, in completion insertion order.
export class CompletedExecutions {
  private readonly completed = new Map<string, number>();
  private gate: Promise<void> = Promise.resolve();
  // Remember completion time for count-based and age-based pruning.
  add(id: string, now = Date.now()): void {
    this.completed.set(id, now);
  }
  // Drop accounting only after the caller has handled the corresponding cleanup.
  forget(id: string): void {
    this.completed.delete(id);
  }
  // Serialize cleanup sweeps so overlapping requests cannot remove the same known execution.
  async prune(
    remove: (id: string) => Promise<void>,
    now = Date.now(),
    reserve = 1,
  ): Promise<void> {
    const previous = this.gate;
    let unlock = () => {};
    this.gate = new Promise((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      // Reserve capacity for an incoming completion and remove oldest entries until both bounds hold.
      for (const [id, finished] of this.completed) {
        if (this.completed.size <= 128 - reserve && now - finished < 3600000)
          break;
        await remove(id);
        this.completed.delete(id);
      }
      // Release the pruning gate even when storage or Job deletion fails.
    } finally {
      unlock();
    }
  }
}
