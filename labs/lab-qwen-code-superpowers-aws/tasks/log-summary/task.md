# Task: access-log summary CLI in TypeScript

No human is available to answer questions during this task. Where these
requirements leave something open, choose the most reasonable option,
write it down in `ASSUMPTIONS.md`, and continue.

Work in the current directory. It contains only this file (`TASK.md`).

## What to build

A command-line program that reads a web-server access log and prints a JSON
summary to stdout.

## Project requirements

- Node.js 22, TypeScript with `"strict": true`, ES modules.
- `package.json` scripts, exactly:
  - `"summarize": "tsx src/cli.ts"`
  - `"test": "vitest run"`
  - `"typecheck": "tsc --noEmit"`
- Dev dependencies at exactly these versions: `typescript` 5.9.3,
  `tsx` 4.23.15, `vitest` 5.0.2, `@types/node` 22.20.4. No other
  dependencies.
- Keep `package-lock.json` in the directory (`npm install` creates it).
- Unit tests with vitest, next to the code they test.

## Running it

    npm run --silent summarize -- <path-to-log-file>

- Success: print the JSON summary to stdout, exit code 0.
- The file does not exist or cannot be read: print an error to stderr,
  print nothing to stdout, exit code 1.
- Not exactly one argument: print usage to stderr, exit code 2.

## Log format

One request per line:

    <client> <ident> <user> [<timestamp>] "<method> <target> <protocol>" <status> <bytes> <duration_ms>

Example:

    10.0.0.1 - alice [28/Sep/2026:10:00:01 +0000] "GET /api/users?page=2 HTTP/1.1" 200 512 12.5

- `client`, `ident`, `user`: any text without spaces.
- `timestamp`: any text without `]` (not validated further).
- `status`: a three-digit number from 100 to 599.
- `bytes`: a non-negative integer or `-`.
- `duration_ms`: a non-negative number, integer or decimal (`12`, `45.5`).
- Lines may end with `\n` or `\r\n`.
- A line that is empty or only whitespace is ignored entirely.
- Any other line that does not match this format exactly is malformed.

## Output

```json
{
  "totalLines": 11,
  "validRequests": 9,
  "malformedLines": 2,
  "statusClasses": { "1xx": 0, "2xx": 5, "3xx": 1, "4xx": 1, "5xx": 2 },
  "topPaths": [
    { "path": "/api/orders", "count": 3 },
    { "path": "/api/users", "count": 3 }
  ],
  "p95LatencyMs": 1200
}
```

- `totalLines`: non-blank lines.
- `validRequests`, `malformedLines`: they add up to `totalLines`.
- `statusClasses`: all five keys always present.
- `topPaths`: the path is the target without its query string (everything
  from the first `?` is dropped). At most 5 entries, sorted by count
  descending, ties by path ascending (plain string comparison).
- `p95LatencyMs`: nearest-rank 95th percentile of `duration_ms` over valid
  requests: sort ascending, take the value at position `ceil(0.95 * n)`
  (1-based). `null` when there are no valid requests.

## Done means

`npm test` and `npm run typecheck` pass, and the CLI prints the right
summary for a sample log you create yourself.
