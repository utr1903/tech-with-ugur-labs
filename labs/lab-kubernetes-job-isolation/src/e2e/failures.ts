import {
  benign,
  type Context,
  checkAttempt,
  type Mode,
  outputPath,
  ownId,
  request,
} from "./context.js";
import type { Seed } from "./storage.js";
import { timeoutCheck } from "./timeout.js";
export function capped(evidence: {
  status: number;
  output: string;
  truncated: boolean;
  outputSize: number;
  metadataSize: number;
  workerTerminated: boolean;
}): boolean {
  return (
    evidence.status === 200 &&
    Buffer.byteLength(evidence.output) === 65536 &&
    evidence.truncated &&
    evidence.outputSize === 65536 &&
    evidence.metadataSize > 0 &&
    evidence.metadataSize <= 128 &&
    evidence.workerTerminated
  );
}
export async function failureChecks(ctx: Context, seeds: Record<Mode, Seed>) {
  for (const mode of ["insecure", "secure"] as const) {
    for (const [operation, body] of [
      ["malformed JSON", "{"],
      ["missing message", "{}"],
      ["empty message", '{"message":""}'],
      ["wrong message type", '{"message":42}'],
      ["oversized body", JSON.stringify({ message: "x".repeat(8193) })],
    ] as const) {
      const attempt = await request(ctx, mode, body, true);
      checkAttempt(
        ctx,
        mode,
        operation,
        "HTTP 400 without creating a Job",
        attempt,
        attempt.response.status === 400 && attempt.jobs.length === 0,
        { submittedBytes: Buffer.byteLength(body) },
      );
      await benign(ctx, mode, `recovery after ${operation}`);
    }
    const userExit = await request(
      ctx,
      mode,
      "printf 'stdout-marker\\n'; printf 'stderr-marker\\n' >&2; exit 7",
    );
    checkAttempt(
      ctx,
      mode,
      "stdout stderr and user exit preservation",
      "HTTP 200, exit7, exact stdout and stderr",
      userExit,
      userExit.response.status === 200 &&
        userExit.response.body.exitCode === 7 &&
        userExit.response.body.output === "stdout-marker\nstderr-marker\n",
    );
    await benign(ctx, mode, "recovery after user exit7");
    await invalidResults(ctx, mode, seeds[mode]);
    await truncated(ctx, mode);
    await timeoutCheck(ctx, mode);
  }
}
async function invalidResults(ctx: Context, mode: Mode, seed: Seed) {
  for (const [operation, command] of [
    ["missing output", 'rm "$HOME/data/$id.md"'],
    [
      "invalid metadata",
      'printf \'{"exitCode":"invalid","truncated":false}\' > "$HOME/data/$id.exit"',
    ],
    ["missing metadata", 'kill -TERM "$PPID"; sleep 1'],
    [
      "output symlink to private canary",
      'rm "$HOME/data/$id.md"; ln -s /data/private/pii.json "$HOME/data/$id.md"',
    ],
    [
      "metadata symlink to private canary",
      'ln -s /data/private/pii.json "$HOME/data/$id.exit"',
    ],
    ["output FIFO", 'rm "$HOME/data/$id.md"; mkfifo "$HOME/data/$id.md"'],
    ["metadata FIFO", 'mkfifo "$HOME/data/$id.exit"'],
    ["output directory", 'rm "$HOME/data/$id.md"; mkdir "$HOME/data/$id.md"'],
    ["metadata directory", 'mkdir "$HOME/data/$id.exit"'],
  ] as const) {
    const attempt = await request(ctx, mode, `${ownId}${command}`);
    const live = await ctx.cluster.workers(mode);
    const deleted =
      attempt.jobs.length > 0 &&
      attempt.jobs.every((job) => !live.some((item) => item.uid === job.uid));
    const generic =
      attempt.response.status === 500 &&
      attempt.response.body.error === "Execution failed." &&
      !(attempt.response.body.output ?? "").includes(seed.contents);
    checkAttempt(
      ctx,
      mode,
      operation,
      "generic HTTP 500, no canary, Job deleted, subsequent execution succeeds",
      attempt,
      generic && deleted,
      {
        operatorSeedConfirmed: seed.exists,
        jobsDeleted: deleted,
        launcherAndReaderDefense: true,
        readerFilesystemTests:
          "src/storage/safe-files.test.ts and store.test.ts",
        limitations:
          "Launcher rejection alone does not prove deployed reader O_NOFOLLOW.",
      },
    );
    await benign(ctx, mode, `recovery after ${operation}`);
  }
}
async function truncated(ctx: Context, mode: Mode) {
  const attempt = await request(ctx, mode, "yes capped-output");
  const id = attempt.response.body.id;
  const sizes = id
    ? await ctx.cluster.node<{ outputSize: number; metadataSize: number }>(
        mode,
        `const fs=require('node:fs'); process.stdout.write(JSON.stringify({outputSize:fs.statSync(${JSON.stringify(outputPath(mode, id))}).size,metadataSize:fs.statSync(${JSON.stringify(outputPath(mode, id, "exit"))}).size}));`,
      )
    : { outputSize: -1, metadataSize: -1 };
  const workerTerminated =
    attempt.jobs.length === 1 &&
    attempt.jobs[0]?.pods.length === 1 &&
    Boolean(
      attempt.jobs[0].pods[0]?.statuses?.every(
        (status) => status.state?.terminated?.exitCode === 0,
      ),
    );
  checkAttempt(
    ctx,
    mode,
    "bounded output and container cleanup",
    "64KiB PVC capture, explicit truncation, worker container terminated",
    attempt,
    capped({
      status: attempt.response.status,
      output: attempt.response.body.output ?? "",
      truncated: attempt.response.body.truncated === true,
      ...sizes,
      workerTerminated,
    }),
    {
      ...sizes,
      workerTerminated,
      truncated: attempt.response.body.truncated,
      captureLimit: 65536,
    },
  );
  await benign(ctx, mode, "recovery after truncated output");
}
