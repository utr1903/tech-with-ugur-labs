import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createSerializer } from "../lib/serialize.js";
import type { ActionProposal } from "../shared/actions.js";

export type Approval = {
  id: string;
  investigationId: string;
  proposal: ActionProposal;
  createdAt: string;
  state: "pending" | "approved" | "denied";
  resolvedAt?: string;
};

export type ApprovalStore = {
  add(investigationId: string, p: ActionProposal): Promise<Approval>;
  list(): Promise<Approval[]>;
  resolve(id: string, state: "approved" | "denied"): Promise<Approval>;
};

export class ApprovalNotFoundError extends Error {
  constructor(id: string) {
    super(`approval ${id} not found`);
    this.name = "ApprovalNotFoundError";
  }
}

export class ApprovalAlreadyResolvedError extends Error {
  constructor(id: string, state: string) {
    super(`approval ${id} is already ${state}`);
    this.name = "ApprovalAlreadyResolvedError";
  }
}

async function load(filePath: string): Promise<Approval[]> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Approval[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Write to a temp file, then rename: readers never see a half-written file. */
async function save(filePath: string, all: Approval[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
  await rename(tmp, filePath);
}

/**
 * File-backed approval queue. Every operation is a serialized
 * read-modify-write, so concurrent requests cannot lose updates and a
 * second resolve of the same approval always sees the first one.
 */
export function createApprovalStore(filePath: string): ApprovalStore {
  const serialize = createSerializer();
  return {
    add: (investigationId, proposal) =>
      serialize(async () => {
        const all = await load(filePath);
        const approval: Approval = {
          id: randomUUID(),
          investigationId,
          proposal,
          createdAt: new Date().toISOString(),
          state: "pending",
        };
        await save(filePath, [...all, approval]);
        return approval;
      }),
    list: () => serialize(() => load(filePath)),
    resolve: (id, state) =>
      serialize(async () => {
        const all = await load(filePath);
        const found = all.find((a) => a.id === id);
        if (!found) throw new ApprovalNotFoundError(id);
        if (found.state !== "pending") {
          throw new ApprovalAlreadyResolvedError(id, found.state);
        }
        const resolved: Approval = {
          ...found,
          state,
          resolvedAt: new Date().toISOString(),
        };
        await save(
          filePath,
          all.map((a) => (a.id === id ? resolved : a)),
        );
        return resolved;
      }),
  };
}
