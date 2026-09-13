import {
  benign,
  type Context,
  checkAttempt,
  type Mode,
  record,
  request,
} from "./context.js";
import { priorResult } from "./prior-results.js";
export type Seed = {
  exists: boolean;
  contents: string;
  uid: number;
  gid: number;
  mode: number;
  directoryMode: number;
};
export function validSeed(seed: Seed): boolean {
  if (
    !seed.exists ||
    seed.uid !== 0 ||
    seed.gid !== 0 ||
    seed.mode !== 0o600 ||
    seed.directoryMode !== 0o700
  )
    return false;
  const value: unknown = JSON.parse(seed.contents);
  return (
    typeof value === "object" &&
    value !== null &&
    "synthetic" in value &&
    value.synthetic === true &&
    "canary" in value &&
    typeof value.canary === "string" &&
    value.canary.startsWith("FAKE-PII-")
  );
}
export async function storageChecks(ctx: Context): Promise<Record<Mode, Seed>> {
  const seeds = {} as Record<Mode, Seed>;
  let exposed = false;
  for (const mode of ["insecure", "secure"] as const) {
    const seed = await ctx.cluster.node<Seed>(
      mode,
      `const fs=require('node:fs'); const path='/data/private/pii.json'; let value={exists:false,contents:'',uid:-1,gid:-1,mode:0,directoryMode:0}; if(fs.existsSync(path)){const s=fs.statSync(path); value={exists:true,contents:fs.readFileSync(path,'utf8'),uid:s.uid,gid:s.gid,mode:s.mode&511,directoryMode:fs.statSync('/data/private').mode&511};} process.stdout.write(JSON.stringify(value));`,
    );
    seeds[mode] = seed;
    record(ctx, {
      operation: "operator seeded private canary",
      mode: "operator",
      expected: `${mode}: synthetic canary root 0:0 private 0700/file 0600`,
      observed: { output: seed.contents },
      evidence: { namespace: mode, ...seed },
      passed: validSeed(seed),
    });
    const attempt = await request(
      ctx,
      mode,
      'printf "executed\\n"; find "$HOME/data" -name pii.json -exec cat {} \\;',
    );
    const actual = attempt.response.body.output ?? "";
    const expected =
      mode === "insecure" ? `executed\n${seed.contents}` : "executed\n";
    const passed =
      attempt.response.status === 200 &&
      attempt.response.body.exitCode === 0 &&
      actual === expected;
    if (mode === "insecure") exposed = passed && validSeed(seed);
    checkAttempt(
      ctx,
      mode,
      "synthetic PII visibility",
      mode === "insecure"
        ? "exact seeded PII is exposed"
        : "command executes without the seeded PII",
      attempt,
      passed,
      {
        denial: mode === "secure",
        operatorConfirmed: validSeed(seed),
        positiveControl: exposed,
        seedPath: "/data/private/pii.json",
      },
    );
    await priorResult(ctx, mode, seed, exposed);
    await traversalCheck(ctx, mode, seed, exposed);
    await benign(ctx, mode, "recovery after traversal");
  }
  return seeds;
}
async function traversalCheck(
  ctx: Context,
  mode: Mode,
  seed: Seed,
  exposed: boolean,
) {
  const traversal = await request(
    ctx,
    mode,
    mode === "insecure"
      ? 'cat "$HOME/data/runs/../private/pii.json"'
      : 'cat "$HOME/data/../private/pii.json"',
  );
  // Insecure traversal deliberately returns the canary; secure traversal cannot reach it.
  checkAttempt(
    ctx,
    mode,
    "path traversal",
    mode === "insecure"
      ? "whole-PVC traversal reaches private canary"
      : "traversal cannot expose private canary",
    traversal,
    traversal.response.status === 200 &&
      (mode === "insecure"
        ? traversal.response.body.output === seed.contents
        : traversal.response.body.exitCode !== 0 &&
          !(traversal.response.body.output ?? "").includes(seed.contents)),
    {
      denial: mode === "secure",
      positiveControl: exposed,
      operatorConfirmed: validSeed(seed),
      target:
        mode === "insecure"
          ? "/home/runner/data/runs/../private/pii.json"
          : "/home/runner/data/../private/pii.json",
    },
  );
}
