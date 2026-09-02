import type { PlanEntry } from "./plan.js";

// Drives one repeating timer per plan entry and hands back a stop function.
// Each destination keeps its own cadence, which is what gives the two workloads
// their different shapes: chatty and small versus periodic and heavy.
export function startSchedule(
  plan: PlanEntry[],
  onTick: (url: string) => void,
): () => void {
  const timers = plan.map((entry) =>
    setInterval(() => onTick(entry.url), entry.everyMs),
  );
  return () => {
    for (const timer of timers) {
      clearInterval(timer);
    }
  };
}
