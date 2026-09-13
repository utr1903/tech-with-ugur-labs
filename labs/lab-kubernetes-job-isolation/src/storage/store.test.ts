import { execFileSync } from "node:child_process";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileExecutionStore } from "./store.js";

const id = "550e8400-e29b-41d4-a716-446655440000";
const logger = pino({ level: "silent" });
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "result-store-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function setup(secure = false) {
  const store = new FileExecutionStore({ root, secure, logger });
  await store.initialize();
  await store.prepare(id);
  return store;
}
async function fixture(secure = false) {
  const store = await setup(secure);
  const path = secure ? join(root, "runs", id) : root;
  await writeFile(join(path, `${id}.md`), "hello\n");
  await writeFile(join(path, `${id}.exit`), '{"exitCode":7,"truncated":false}');
  return { store, path };
}
describe("result store", () => {
  it("seeds synthetic private data and restricts secure directory ownership", async () => {
    const store = await setup(true);
    const seeded = JSON.parse(
      await readFile(join(root, "private", "pii.json"), "utf8"),
    );
    expect(seeded.synthetic).toBe(true);
    expect(seeded.canary).toMatch(/^FAKE-PII-/);
    expect(seeded.email).toBe("synthetic.person@example.invalid");
    expect((await stat(root)).mode & 0o777).toBe(0o755);
    expect((await stat(join(root, "private"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, "private", "pii.json"))).mode & 0o777).toBe(
      0o600,
    );
    const directory = await stat(join(root, "runs", id));
    expect(directory.mode & 0o777).toBe(0o700);
    expect(directory.uid).toBe(10001);
    expect(directory.gid).toBe(10001);
    await expect(store.prepare(id)).rejects.toMatchObject({
      kind: "infrastructure",
    });
  });
  it.each([false, true])(
    "reads known regular result files in secure=%s",
    async (secure) => {
      const { store } = await fixture(secure);
      expect(await store.read(id)).toEqual({
        id,
        exitCode: 7,
        output: "hello\n",
      });
    },
  );
  it("accepts exactly 64KiB and includes explicit truncation", async () => {
    const { store, path } = await fixture();
    await writeFile(join(path, `${id}.md`), "a".repeat(65536));
    await writeFile(
      join(path, `${id}.exit`),
      '{"exitCode":143,"truncated":true}',
    );
    expect(await store.read(id)).toMatchObject({
      exitCode: 143,
      truncated: true,
      output: "a".repeat(65536),
    });
  });
  it.each(["../../private/pii", "550e8400-e29b-41d4-a716-446655440099"])(
    "rejects an unknown generated path %s",
    async (unknown) => {
      const store = await setup();
      await expect(store.read(unknown)).rejects.toMatchObject({
        kind: "infrastructure",
      });
      await expect(
        store.prepare(unknown.includes("/") ? unknown : "not-an-id"),
      ).rejects.toMatchObject({ kind: "infrastructure" });
    },
  );
  it.each(["md", "exit"])("rejects a symlink %s result", async (suffix) => {
    const { store, path } = await fixture();
    const target = join(path, `${id}.${suffix}`);
    await rm(target);
    await symlink(join(root, "private", "pii.json"), target);
    await expect(store.read(id)).rejects.toMatchObject({
      kind: "infrastructure",
    });
  });
  it("rejects a hardlinked private result", async () => {
    const { store, path } = await fixture();
    await rm(join(path, `${id}.md`));
    await link(join(root, "private", "pii.json"), join(path, `${id}.md`));
    await expect(store.read(id)).rejects.toMatchObject({
      kind: "infrastructure",
    });
  });
  it.each(["md", "exit"])("rejects nonregular directory %s", async (suffix) => {
    const { store, path } = await fixture();
    const target = join(path, `${id}.${suffix}`);
    await rm(target);
    await mkdir(target);
    await expect(store.read(id)).rejects.toMatchObject({
      kind: "infrastructure",
    });
  });
  it("rejects a FIFO without waiting for its writer", async () => {
    const { store, path } = await fixture();
    const target = join(path, `${id}.md`);
    await rm(target);
    execFileSync("mkfifo", [target]);
    await expect(store.read(id)).rejects.toMatchObject({
      kind: "infrastructure",
    });
  }, 1000);
  it.each([
    "{",
    '{"exitCode":0}',
    '{"exitCode":256,"truncated":false}',
    '{"exitCode":1.5,"truncated":false}',
    '{"exitCode":0,"truncated":"false"}',
    '{"exitCode":0,"truncated":false,"extra":1}',
    "x".repeat(129),
  ])("rejects malformed or oversized metadata %s", async (metadata) => {
    const { store, path } = await fixture();
    await writeFile(join(path, `${id}.exit`), metadata);
    await expect(store.read(id)).rejects.toMatchObject({
      kind: "infrastructure",
    });
  });
  it("rejects oversized output and missing output", async () => {
    const { store, path } = await fixture();
    await writeFile(join(path, `${id}.md`), "x".repeat(65537));
    await expect(store.read(id)).rejects.toMatchObject({
      kind: "infrastructure",
    });
    await rm(join(path, `${id}.md`));
    await expect(store.read(id)).rejects.toMatchObject({
      kind: "infrastructure",
    });
  });
  it("cleanup removes only generated output and preserves the private seed", async () => {
    const { store, path } = await fixture(true);
    await store.remove(id);
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(join(root, "private", "pii.json"))).isFile()).toBe(true);
    await expect(store.remove("../../private")).rejects.toMatchObject({
      kind: "infrastructure",
    });
  });
});
