export type Hit = { ts: number; event: string; [field: string]: unknown };

const MAX_HITS = 1000;

/**
 * In-memory hit log for check scripts. Bounded to the last MAX_HITS entries
 * and lost on restart - fine for a lab, nothing here is meant to persist.
 */
export class HitStore {
  private hits: Hit[] = [];

  add(event: string, fields: Record<string, unknown>): Hit {
    const hit: Hit = { ts: Date.now(), event, ...fields };
    this.hits.push(hit);
    if (this.hits.length > MAX_HITS) this.hits.shift();
    return hit;
  }

  since(ms: number): Hit[] {
    return this.hits.filter((h) => h.ts >= ms);
  }
}
