export interface BudgetDecision {
  allowed: boolean;
  remaining: number;
  retryAfterS: number;
}

/**
 * A sliding-window call budget, per user. An agent task is roughly 5-15 calls,
 * so the default of 30 in 300s is generous for a person and immediately
 * uncomfortable for a script.
 */
export class CallBudget {
  readonly #hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryConsume(userId: string): BudgetDecision {
    const cutoff = this.now() - this.windowSeconds * 1000;
    const recent = (this.#hits.get(userId) ?? []).filter((at) => at > cutoff);

    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? this.now();
      this.#hits.set(userId, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterS: Math.max(1, Math.ceil((oldest - cutoff) / 1000)),
      };
    }

    recent.push(this.now());
    this.#hits.set(userId, recent);
    return {
      allowed: true,
      remaining: this.limit - recent.length,
      retryAfterS: 0,
    };
  }
}
