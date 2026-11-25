/**
 * A promise chain that runs async tasks strictly one at a time, in
 * submission order. A failing task rejects its own promise but never
 * blocks the tasks queued behind it.
 */
export function createSerializer(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}
