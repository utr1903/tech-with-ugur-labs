import type { ResearchRequest } from "./input.js";
import type { PlanTask } from "./plan-milestones.js";

export interface Limits {
  maxReads: number;
  maxCalls: number;
  crawlLimit: number;
  crawlDepth: number;
  maxPageCharacters: number;
  maxDurationMs: number;
}

export interface Source {
  id: string;
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  operation: string;
}

interface LedgerEvent {
  kind:
    | "attempt"
    | "success"
    | "failure"
    | "denial"
    | "cap"
    | "plan"
    | "candidate"
    | "link";
  operation: string;
  url?: string;
  sourceId?: string;
  reason?: string;
  tasks?: PlanTask[];
}

export interface LedgerSnapshot {
  request: ResearchRequest;
  limits: Limits;
  counts: { reads: number; calls: number };
  sources: Source[];
  events: LedgerEvent[];
}

export interface Ledger {
  readonly limits: Readonly<Limits>;
  snapshot(): LedgerSnapshot;
  record(event: LedgerEvent): void;
  takeCall(operation: string, url: string): boolean;
  takeRead(operation: string, url: string): boolean;
  getSource(url: string): Source | undefined;
  addSource(source: Omit<Source, "id">): Source;
}

const defaults: Limits = {
  maxReads: 16,
  maxCalls: 24,
  crawlLimit: 5,
  crawlDepth: 2,
  maxPageCharacters: 40_000,
  maxDurationMs: 180_000,
};

export function createLedger(
  request: ResearchRequest,
  overrides: Partial<Limits> = {},
): Ledger {
  const limits = Object.freeze(normalizeLimits(overrides));
  const state: LedgerSnapshot = {
    request: structuredClone(request),
    limits,
    counts: { reads: 0, calls: 0 },
    sources: [],
    events: [],
  };
  const record = (event: LedgerEvent): void => {
    state.events.push(structuredClone(event));
  };
  const take = (
    kind: "reads" | "calls",
    operation: string,
    url: string,
  ): boolean => {
    const maximum = kind === "reads" ? limits.maxReads : limits.maxCalls;
    if (state.counts[kind] >= maximum) {
      record({
        kind: "cap",
        operation,
        url,
        reason: kind === "reads" ? "read-budget" : "call-budget",
      });
      return false;
    }
    state.counts[kind] += 1;
    return true;
  };
  const getSource = (url: string): Source | undefined => {
    const source = state.sources.find((source) => source.url === url);
    return source && structuredClone(source);
  };
  return {
    limits,
    snapshot: () => structuredClone(state),
    record,
    takeCall: (operation, url) => take("calls", operation, url),
    takeRead: (operation, url) => take("reads", operation, url),
    getSource,
    addSource: (input) => {
      const existing = getSource(input.url);
      if (existing) return existing;
      const source = {
        ...structuredClone(input),
        id: `S${state.sources.length + 1}`,
      };
      state.sources.push(source);
      record({
        kind: "success",
        operation: input.operation,
        url: input.url,
        sourceId: source.id,
      });
      return structuredClone(source);
    },
  };
}

function normalizeLimits(overrides: Partial<Limits>): Limits {
  const limits = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof Limits)[]) {
    const value = overrides[key];
    if (value !== undefined && Number.isFinite(value) && value >= 1)
      limits[key] = Math.min(defaults[key], Math.floor(value));
  }
  return limits;
}
