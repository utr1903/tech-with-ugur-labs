import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { expect, it } from "vitest";
import { FileExecutionStore } from "../storage/store.js";
import { KubernetesExecutionService } from "./service.js";
import { ExecutionError, type JobClient } from "./types.js";

it.each(["md", "exit"])(
  "cleans a rejected %s directory and executes the next request",
  async (suffix) => {
    const root = await mkdtemp(join(tmpdir(), "store-recovery-"));
    try {
      const logger = pino({ level: "silent" });
      const store = new FileExecutionStore({ root, secure: false, logger });
      await store.initialize();
      let creates = 0;
      let deletes = 0;
      let rejectedId = "";
      const jobs: JobClient = {
        create: async (id) => {
          creates++;
          if (creates === 1) {
            rejectedId = id;
            await mkdir(join(root, `${id}.${suffix}`));
            await symlink(
              join(root, "private"),
              join(root, `${id}.${suffix}`, "private-link"),
            );
          } else {
            await writeFile(join(root, `${id}.md`), "recovered\n");
            await writeFile(
              join(root, `${id}.exit`),
              '{"exitCode":0,"truncated":false}',
            );
          }
        },
        wait: async () => {
          if (creates === 1) throw new ExecutionError("infrastructure");
        },
        remove: async () => {
          deletes++;
        },
      };
      const service = new KubernetesExecutionService(store, jobs, logger);
      await expect(service.execute("true")).rejects.toMatchObject({
        kind: "infrastructure",
      });
      const result = await service.execute("true");
      expect(result).toMatchObject({ exitCode: 0, output: "recovered\n" });
      expect(creates).toBe(2);
      expect(deletes).toBe(1);
      await expect(
        stat(join(root, `${rejectedId}.${suffix}`)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect((await stat(join(root, "private", "pii.json"))).isFile()).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
