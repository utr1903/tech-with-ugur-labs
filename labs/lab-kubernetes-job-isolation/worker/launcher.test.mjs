import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('./launcher.mjs', import.meta.url));

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'worker-test-'));
  const data = join(home, 'data');
  await mkdir(data);
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home, data, id: randomUUID() };
}

function execute(f, message, configuration = { id: f.id, message }) {
  const child = spawn(process.execPath, [launcher], {
    env: { ...process.env, HOME: f.home, OUTPUT_LIMIT_BYTES: '65536', EXECUTION_CONFIG: JSON.stringify(configuration) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let error = '';
  child.stderr.on('data', (chunk) => { error += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
  const done = new Promise((resolve) => child.on('close', (code, signal) => {
    clearTimeout(timer);
    resolve({ code, signal, error });
  }));
  return { child, done };
}

async function result(f, message) {
  const outcome = await execute(f, message).done;
  assert.equal(outcome.code, 0, outcome.error);
  return {
    output: await readFile(join(f.data, `${f.id}.md`)),
    metadata: JSON.parse(await readFile(join(f.data, `${f.id}.exit`), 'utf8')),
  };
}

async function waitForFile(path) {
  for (let i = 0; i < 100; i++) {
    try { return await readFile(path, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(10);
  }
  assert.fail(`Child did not write ${path}`);
}

async function assertStopped(pid) {
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(pid, 0);
      // Linux container PID1 may retain zombies; they no longer execute.
      if (process.platform === 'linux' && /^State:\s+Z/m.test(await readFile(`/proc/${pid}/status`, 'utf8'))) return;
    } catch (error) {
      if (error.code === 'ESRCH' || error.code === 'ENOENT') return;
      throw error;
    }
    await delay(10);
  }
  assert.fail(`Process ${pid} is still executing`);
}

test('captures exact stdout and successful exit', async (t) => {
  const f = await fixture(t);
  const actual = await result(f, "printf 'hello\\n'");
  assert.equal(actual.output.toString(), 'hello\n');
  assert.deepEqual(actual.metadata, { exitCode: 0, truncated: false });
});

test('captures stderr and preserves nonzero command exit', async (t) => {
  const f = await fixture(t);
  const actual = await result(f, "printf 'err\\n' >&2; exit 7");
  assert.equal(actual.output.toString(), 'err\n');
  assert.deepEqual(actual.metadata, { exitCode: 7, truncated: false });
});

test('merges both streams in observed arrival order', async (t) => {
  const f = await fixture(t);
  const actual = await result(f, "printf 'out\\n'; sleep 0.1; printf 'err\\n' >&2");
  assert.equal(actual.output.toString(), 'out\nerr\n');
});

test('caps endless output and stops its entire group promptly', async (t) => {
  const f = await fixture(t);
  const actual = await result(f, 'sleep 100 & echo $! > "$HOME/child.pid"; yes x');
  assert.equal(actual.output.length, 65536);
  assert.equal(actual.metadata.truncated, true);
  assert.ok([143, 137].includes(actual.metadata.exitCode));
  await assertStopped(Number(await readFile(join(f.home, 'child.pid'), 'utf8')));
});

test('does not mark an exactly full completed output as truncated', async (t) => {
  const f = await fixture(t);
  const actual = await result(f, "node -e 'process.stdout.write(Buffer.alloc(65536, 97))'");
  assert.equal(actual.output.length, 65536);
  assert.deepEqual(actual.metadata, { exitCode: 0, truncated: false });
});

test('preserves normal exit while cleaning background descendants', async (t) => {
  const f = await fixture(t);
  const actual = await result(f, 'sleep 100 & echo $! > "$HOME/child.pid"; printf done; exit 7');
  assert.equal(actual.output.toString(), 'done');
  assert.deepEqual(actual.metadata, { exitCode: 7, truncated: false });
  await assertStopped(Number(await readFile(join(f.home, 'child.pid'), 'utf8')));
});

test('escalates cleanup for descendants ignoring SIGTERM', async (t) => {
  const f = await fixture(t);
  const actual = await result(f, 'sh -c \'trap "" TERM; echo $$ > "$HOME/child.pid"; while :; do sleep 1; done\' & sleep 0.1; printf done');
  assert.equal(actual.output.toString(), 'done');
  await assertStopped(Number(await readFile(join(f.home, 'child.pid'), 'utf8')));
});

test('does not wait indefinitely for pipes retained by a new session', async (t) => {
  const f = await fixture(t);
  const running = execute(f, 'setsid sh -c \'echo $$ > "$HOME/escaped.pid"; sleep 100\' & sleep 0.1; printf done');
  const pid = Number(await waitForFile(join(f.home, 'escaped.pid')));
  t.after(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} });
  assert.equal((await running.done).code, 0);
  assert.equal(await readFile(join(f.data, `${f.id}.md`), 'utf8'), 'done');
});

test('applies one byte budget across stdout and stderr', async (t) => {
  const f = await fixture(t);
  const actual = await result(f, "node -e 'process.stdout.write(Buffer.alloc(40000,97)); process.stderr.write(Buffer.alloc(40000,98))'");
  assert.equal(actual.output.length, 65536);
  assert.equal(actual.metadata.truncated, true);
});

test('launcher termination stops waiting command without successful metadata', async (t) => {
  const f = await fixture(t);
  const running = execute(f, 'sleep 10 & echo $! > "$HOME/child.pid"; wait');
  const pid = Number(await waitForFile(join(f.home, 'child.pid')));
  running.child.kill('SIGTERM');
  const outcome = await running.done;
  assert.notEqual(outcome.code, 0);
  assert.equal((await readdir(f.data)).includes(`${f.id}.exit`), false);
  await assertStopped(pid);
});

test('rejects malformed UUID and configuration before producing files', async (t) => {
  for (const configuration of [null, { id: '../escape', message: 'true' }, { id: `${randomUUID()}\n`, message: 'true' }, { id: randomUUID(), message: 'true', extra: 1 }, { id: randomUUID(), message: 1 }]) {
    const f = await fixture(t);
    assert.notEqual((await execute(f, '', configuration).done).code, 0);
    assert.deepEqual(await readdir(f.data), []);
  }
});

test('never follows precreated output or metadata symlinks', async (t) => {
  for (const suffix of ['md', 'exit']) {
    const f = await fixture(t);
    const target = join(f.home, 'private');
    await writeFile(target, 'private-marker');
    await symlink(target, join(f.data, `${f.id}.${suffix}`));
    assert.notEqual((await execute(f, 'printf changed').done).code, 0);
    assert.equal(await readFile(target, 'utf8'), 'private-marker');
  }
});

test('reports result-path replacement as infrastructure failure without following it', async (t) => {
  const f = await fixture(t);
  const target = join(f.home, 'private');
  await writeFile(target, 'private-marker');
  const command = `rm "$HOME/data/${f.id}.md"; ln -s "$HOME/private" "$HOME/data/${f.id}.md"; printf changed`;
  assert.notEqual((await execute(f, command).done).code, 0);
  assert.equal(await readFile(target, 'utf8'), 'private-marker');
  assert.equal((await readdir(f.data)).includes(`${f.id}.exit`), false);
});
