import type { AlertContext } from "../tools/types.js";

type Seen = { at: number; reportId: string };

/**
 * Remembers which alert fingerprints an investigation already covers for
 * `windowMs`. Alertmanager re-sends firing alerts on every repeat interval;
 * without this the agent would pay for the same investigation again.
 */
export function createDeduper(windowMs: number, now: () => number) {
  const seen = new Map<string, Seen>();

  function active(fp: string): Seen | undefined {
    const s = seen.get(fp);
    if (!s) return undefined;
    if (now() - s.at >= windowMs) {
      seen.delete(fp);
      return undefined;
    }
    return s;
  }

  return {
    filterNew(alerts: AlertContext[]): {
      fresh: AlertContext[];
      relatedTo?: string;
    } {
      const fresh: AlertContext[] = [];
      const batch = new Set<string>();
      let latest: Seen | undefined;
      for (const a of alerts) {
        const old = active(a.fingerprint);
        if (old) {
          if (!latest || old.at >= latest.at) latest = old;
        } else if (!batch.has(a.fingerprint)) {
          batch.add(a.fingerprint);
          fresh.push(a);
        }
      }
      return latest ? { fresh, relatedTo: latest.reportId } : { fresh };
    },
    remember(fps: string[], reportId: string): void {
      for (const fp of fps) seen.set(fp, { at: now(), reportId });
    },
  };
}

export type Deduper = ReturnType<typeof createDeduper>;
