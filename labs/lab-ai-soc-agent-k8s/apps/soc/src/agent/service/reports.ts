import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActionOutcome, ActionProposal } from "../../shared/actions.js";
import type { Verdict } from "../../shared/verdict.js";
import type { Usage } from "../loop/usage.js";
import type { AlertContext } from "../tools/types.js";
import { renderMarkdown } from "./render.js";

export type Report = {
  id: string;
  mode: "investigate" | "hunt";
  createdAt: string;
  finishedAt: string;
  alerts: AlertContext[];
  relatedTo?: string;
  verdicts: Verdict[];
  proposals: ActionProposal[];
  outcomes: ActionOutcome[];
  usage: Usage;
  stopReason: string;
  budgetExhausted: boolean;
  model: string;
};

export type ReportSummary = Pick<
  Report,
  "id" | "mode" | "createdAt" | "finishedAt" | "relatedTo"
>;

const ID_PATTERN = /^(inv|hunt)-\d{8}T\d{6}-[0-9a-f]{4}$/;

/** `inv-<UTC yyyymmddThhmmss>-<4 hex>`; ids sort by time within a mode. */
export function newReportId(mode: Report["mode"], now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "");
  const prefix = mode === "hunt" ? "hunt" : "inv";
  return `${prefix}-${stamp}-${randomBytes(2).toString("hex")}`;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

export function createReportStore(dir: string) {
  return {
    /** The markdown is written first: the JSON file marks a report as saved. */
    async save(r: Report): Promise<void> {
      await mkdir(dir, { recursive: true });
      await writeAtomic(join(dir, `${r.id}.md`), renderMarkdown(r));
      await writeAtomic(join(dir, `${r.id}.json`), JSON.stringify(r, null, 2));
    },
    async get(id: string): Promise<Report | undefined> {
      if (!ID_PATTERN.test(id)) return undefined;
      try {
        return JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
    },
    async list(): Promise<ReportSummary[]> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const ids = names
        .filter((n) => n.endsWith(".json"))
        .map((n) => n.slice(0, -5))
        .filter((id) => ID_PATTERN.test(id));
      const all = await Promise.all(ids.map((id) => this.get(id)));
      return all
        .filter((r): r is Report => r !== undefined)
        .map(({ id, mode, createdAt, finishedAt, relatedTo }) => ({
          id,
          mode,
          createdAt,
          finishedAt,
          ...(relatedTo ? { relatedTo } : {}),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}

export type ReportStore = ReturnType<typeof createReportStore>;
