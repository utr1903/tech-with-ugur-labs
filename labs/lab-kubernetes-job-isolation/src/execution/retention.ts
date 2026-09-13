export class CompletedExecutions {
  private readonly completed = new Map<string, number>();
  private gate: Promise<void> = Promise.resolve();
  add(id: string, now = Date.now()): void {
    this.completed.set(id, now);
  }
  forget(id: string): void {
    this.completed.delete(id);
  }
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
      for (const [id, finished] of this.completed) {
        if (this.completed.size <= 128 - reserve && now - finished < 3600000)
          break;
        await remove(id);
        this.completed.delete(id);
      }
    } finally {
      unlock();
    }
  }
}
