import { randomUUID } from "node:crypto";
import {
  type Context,
  checkAttempt,
  type Mode,
  outputPath,
  record,
  request,
} from "./context.js";
import type { Response } from "./http.js";
import { type Seed, validSeed } from "./storage.js";
// A denial is meaningful only when the earlier unique result is independently confirmed present.
export function priorObservation(
  mode: Mode,
  actual: Response,
  marker: string,
  retained: { exists: boolean; output: string },
  created: boolean,
): boolean {
  if (
    !created ||
    !retained.exists ||
    retained.output !== marker ||
    actual.status !== 200
  )
    return false;
  if (mode === "insecure")
    return actual.body.exitCode === 0 && actual.body.output === marker;
  return (
    Number.isInteger(actual.body.exitCode) &&
    (actual.body.exitCode ?? 0) > 0 &&
    typeof actual.body.output === "string" &&
    !actual.body.output.includes(marker)
  );
}
// Create and inspect a prior result, probe known paths from another Job, then confirm it survived.
export async function priorResult(
  ctx: Context,
  mode: Mode,
  seed: Seed,
  exposed: boolean,
) {
  const marker = `PRIOR-RESULT-${randomUUID()}\n`;
  const prior = await request(ctx, mode, `printf '${marker}'`);
  const id = prior.response.body.id;
  const created = checkAttempt(
    ctx,
    mode,
    "create retained prior result",
    "exact unique marker",
    prior,
    prior.response.status === 200 &&
      prior.response.body.exitCode === 0 &&
      prior.response.body.output === marker,
  );
  if (!id) return;
  const path = outputPath(mode, id);
  const retained = await ctx.cluster.node<{ exists: boolean; output: string }>(
    mode,
    `const fs=require('node:fs'); const path=${JSON.stringify(path)}; process.stdout.write(JSON.stringify({exists:fs.existsSync(path),output:fs.existsSync(path)?fs.readFileSync(path,'utf8'):''}));`,
  );
  record(ctx, {
    operation: "operator retained prior result",
    mode: "operator",
    expected: `${mode}: exact prior file survives retention`,
    observed: { output: retained.output },
    evidence: { id, path, exists: retained.exists },
    passed: retained.exists && retained.output === marker,
  });
  const workerPath =
    mode === "insecure"
      ? `/home/runner/data/${id}.md`
      : `/home/runner/data/runs/${id}/${id}.md`;
  const next = await request(ctx, mode, `cat '${workerPath}'`);
  checkAttempt(
    ctx,
    mode,
    "cross-Job known prior result",
    mode === "insecure"
      ? "exact retained marker is exposed"
      : "known prior file is inaccessible",
    next,
    priorObservation(mode, next.response, marker, retained, created),
    {
      denial: mode === "secure",
      operatorConfirmed:
        retained.exists && retained.output === marker && validSeed(seed),
      positiveControl: created && exposed,
      priorId: id,
      operatorPath: path,
      workerPath,
    },
  );
  const traversalAttempt = await request(
    ctx,
    mode,
    `cat '/home/runner/data/../${id}/${id}.md'`,
  );
  checkAttempt(
    ctx,
    mode,
    "cross-Job subPath traversal",
    "traversal cannot disclose prior marker",
    traversalAttempt,
    traversalAttempt.response.status === 200 &&
      traversalAttempt.response.body.exitCode !== 0 &&
      !(traversalAttempt.response.body.output ?? "").includes(marker),
    {
      denial: true,
      operatorConfirmed: retained.exists && retained.output === marker,
      positiveControl: created,
      operatorPath: path,
    },
  );
  const stillRetained = await ctx.cluster.node<{ output: string }>(
    mode,
    `process.stdout.write(JSON.stringify({output:require('node:fs').readFileSync(${JSON.stringify(path)},'utf8')}));`,
  );
  record(ctx, {
    operation: "operator prior result after probes",
    mode: "operator",
    expected: "prior marker retained after cross-Job probes",
    observed: { output: stillRetained.output },
    evidence: { namespace: mode, id, path },
    passed: stillRetained.output === marker,
  });
}
