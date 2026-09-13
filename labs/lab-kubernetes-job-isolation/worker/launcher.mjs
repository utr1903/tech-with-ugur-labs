import { spawn } from 'node:child_process';
import { constants, openSync, closeSync, writeSync, fstatSync, lstatSync, fsyncSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { join } from 'node:path';

let child;
let capture;
let infrastructureError = false;
let stopPromise;

function signalGroup(signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if (error.code !== 'ESRCH') infrastructureError = true;
  }
}

function stopGroup() {
  if (!stopPromise) {
    signalGroup('SIGTERM');
    stopPromise = new Promise((resolve) => setTimeout(() => {
      signalGroup('SIGKILL');
      // Bound draining even if a descendant escaped the original process group.
      // Container termination is still required to clean up such descendants.
      child?.stdout.destroy();
      child?.stderr.destroy();
      resolve();
    }, 150));
  }
  return stopPromise;
}

function create(path) {
  const handle = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600);
  if (!fstatSync(handle).isFile()) {
    closeSync(handle);
    throw new Error('Result is not a regular file');
  }
  return handle;
}

function verifyPath(path, handle, maximum) {
  const held = fstatSync(handle);
  const named = lstatSync(path);
  if (!held.isFile() || !named.isFile() || held.dev !== named.dev || held.ino !== named.ino || held.nlink !== 1 || held.size > maximum) {
    throw new Error('Result path was changed');
  }
}

async function main() {
  const config = JSON.parse(process.env.EXECUTION_CONFIG);
  if (!config || Array.isArray(config) || Object.keys(config).length !== 2 ||
      typeof config.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.id) ||
      typeof config.message !== 'string' || config.message.length === 0 || Buffer.byteLength(config.message) > 8192) {
    throw new Error('Invalid execution configuration');
  }
  const outputPath = join(process.env.HOME, 'data', `${config.id}.md`);
  const exitPath = join(process.env.HOME, 'data', `${config.id}.exit`);
  const limit = Number(process.env.OUTPUT_LIMIT_BYTES);
  if (limit !== 65536) throw new Error('Invalid output limit');
  capture = create(outputPath);
  let size = 0;
  let truncated = false;
  child = spawn('/bin/sh', ['-c', config.message], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      stopGroup();
      // Conventional shell status: 128 + the signal number (TERM=143, KILL=137).
      // A normal shell exit is preserved even when background children are killed.
      resolve(code ?? 128 + osConstants.signals[signal]);
    });
  });
  function consume(chunk) {
    if (infrastructureError || truncated) return;
    try {
      const bytes = chunk.subarray(0, limit - size);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(capture, bytes, offset, bytes.length - offset);
      size += bytes.length;
      if (chunk.length > bytes.length) {
        truncated = true;
        stopGroup();
      }
    } catch {
      infrastructureError = true;
      stopGroup();
    }
  }
  child.stdout.on('data', consume);
  child.stderr.on('data', consume);
  for (const stream of [child.stdout, child.stderr]) stream.on('error', () => {
    infrastructureError = true;
    stopGroup();
  });
  const exitCode = await exited;
  await stopGroup();
  if (infrastructureError) throw new Error('Execution collection failed');
  verifyPath(outputPath, capture, limit);
  fsyncSync(capture);
  closeSync(capture);
  capture = undefined;
  const metadata = create(exitPath);
  try {
    const bytes = Buffer.from(JSON.stringify({ exitCode, truncated }));
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(metadata, bytes, offset, bytes.length - offset);
    verifyPath(exitPath, metadata, 128);
    fsyncSync(metadata);
  } finally { closeSync(metadata); }
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => {
  infrastructureError = true;
  stopGroup().then(() => process.exit(1));
});

main().catch(async () => {
  infrastructureError = true;
  await stopGroup();
  if (capture !== undefined) closeSync(capture);
  process.stderr.write('Worker result collection failed\n');
  process.exitCode = 1;
});
