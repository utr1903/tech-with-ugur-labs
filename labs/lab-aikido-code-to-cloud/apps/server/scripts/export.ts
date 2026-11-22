import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { generateDataset } from "./generate";

export async function writeDataset(dir: string, data: Map<string, unknown>): Promise<number> {
  for (const [key, value] of data) {
    const path = join(dir, key);
    await mkdir(dirname(path), { recursive: true });
    const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    await writeFile(path, body, "utf8");
  }
  return data.size;
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      customers: { type: "string", default: "25" },
      seed: { type: "string", default: "42" },
    },
  });
  if (!values.out) {
    console.error("usage: export --out <dir> [--customers 25] [--seed 42]");
    process.exit(1);
  }
  const data = generateDataset({ customers: Number(values.customers), seed: Number(values.seed), now: new Date() });
  const count = await writeDataset(values.out, data);
  console.log(`Exported ${count} files to ${values.out}`);
}

// Run the CLI only when executed directly (tsx), not when imported by tests.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
