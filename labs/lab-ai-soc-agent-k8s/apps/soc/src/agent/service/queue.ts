/** Runs jobs one at a time, in order. A failing job never blocks the next. */
export function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    enqueue<T>(job: () => Promise<T>): Promise<T> {
      pending++;
      const result = tail.then(job);
      tail = result
        .catch(() => undefined)
        .finally(() => {
          pending--;
        });
      return result;
    },
    size: () => pending,
  };
}

export type Queue = ReturnType<typeof createQueue>;
