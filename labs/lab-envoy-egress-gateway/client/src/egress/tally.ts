export type Tally = {
  successesByDestination: Record<string, number>;
  bytesByDestination: Record<string, number>;
  deniedCount: number;
  failureCount: number;
};

export function createTally(): Tally {
  return {
    successesByDestination: {},
    bytesByDestination: {},
    deniedCount: 0,
    failureCount: 0,
  };
}

export function recordSuccess(tally: Tally, url: string, bytes: number): void {
  const destination = new URL(url).hostname;
  tally.successesByDestination[destination] =
    (tally.successesByDestination[destination] ?? 0) + 1;
  tally.bytesByDestination[destination] =
    (tally.bytesByDestination[destination] ?? 0) + bytes;
}

export function recordDenied(tally: Tally): void {
  tally.deniedCount += 1;
}

export function recordFailure(tally: Tally): void {
  tally.failureCount += 1;
}

export function totalSuccesses(tally: Tally): number {
  return Object.values(tally.successesByDestination).reduce(
    (sum, count) => sum + count,
    0,
  );
}
