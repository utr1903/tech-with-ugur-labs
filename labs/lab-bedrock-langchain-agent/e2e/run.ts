import { count, eq, isNull } from "drizzle-orm";
import { MODEL_KEYS } from "../src/agent/models.js";
import { createDatabase } from "../src/db/client.js";
import { customers, orders, products } from "../src/db/schema.js";
import { type CellResult, renderGrid } from "./grid.js";
import { answerContains } from "./normalize.js";
import { QUESTIONS } from "./questions.js";

/**
 * The end-to-end check of the lab, run by `make e2e` against the running
 * stack with real Bedrock calls. Requests are sent one after another to
 * avoid throttling. Exits non-zero unless every check passed.
 */
const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";
const print = (line: string) => process.stdout.write(`${line}\n`);
let failedChecks = 0;

function check(name: string, passed: boolean, detail = ""): void {
  print(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!passed) failedChecks += 1;
}

async function post(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function checkReady(): Promise<void> {
  const response = await fetch(`${baseUrl}/readyz`);
  check(
    "GET /readyz returns 200",
    response.status === 200,
    `${response.status}`,
  );
}

/**
 * Checks the seeded row counts and referential integrity. The pool is
 * closed in `finally` so a failed query never leaves a connection open.
 */
async function checkData(): Promise<void> {
  const { db, pool } = createDatabase(process.env.DATABASE_URL ?? "");
  try {
    const [c] = await db.select({ n: count() }).from(customers);
    const [p] = await db.select({ n: count() }).from(products);
    const [o] = await db.select({ n: count() }).from(orders);
    const found = `${c?.n}/${p?.n}/${o?.n}`;
    check("Row counts are 20/15/60", found === "20/15/60", found);
    const noCustomer = await db
      .select({ id: orders.id })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(isNull(customers.id));
    const noProduct = await db
      .select({ id: orders.id })
      .from(orders)
      .leftJoin(products, eq(orders.productId, products.id))
      .where(isNull(products.id));
    const orphans = noCustomer.length + noProduct.length;
    check("No order is orphaned", orphans === 0, `${orphans} orphaned`);
  } finally {
    await pool.end();
  }
}

async function askOne(
  question: (typeof QUESTIONS)[number],
  model: string,
): Promise<CellResult> {
  const cell = { questionId: question.id, model };
  try {
    const response = await post({ model, query: question.question });
    const body = (await response.json()) as {
      answer?: string;
      toolCalls?: unknown[];
      error?: { code: string };
    };
    if (!response.ok) {
      return {
        ...cell,
        passed: false,
        reason: `HTTP ${response.status} ${body.error?.code ?? ""}`,
      };
    }
    if ((body.toolCalls ?? []).length === 0) {
      return { ...cell, passed: false, reason: "no tool call" };
    }
    const missing = question.expected.filter(
      (value) => !answerContains(body.answer ?? "", value),
    );
    return missing.length === 0
      ? { ...cell, passed: true, reason: "" }
      : {
          ...cell,
          passed: false,
          reason: `expected ${missing.join(" and ")}, got: ${(body.answer ?? "").slice(0, 160)}`,
        };
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    return { ...cell, passed: false, reason: `request failed (${name})` };
  }
}

async function askAll(): Promise<CellResult[]> {
  const results: CellResult[] = [];
  for (const question of QUESTIONS) {
    for (const model of MODEL_KEYS) {
      const result = await askOne(question, model);
      print(`${result.passed ? "PASS" : "FAIL"}  ${question.id} on ${model}`);
      results.push(result);
    }
  }
  return results;
}

async function checkRejections(): Promise<void> {
  const unknown = await post({ model: "not-a-model", query: "hello" });
  check(
    "Unknown model returns 400",
    unknown.status === 400,
    `${unknown.status}`,
  );
  const missing = await post({ model: MODEL_KEYS[0] });
  check(
    "Missing query returns 400",
    missing.status === 400,
    `${missing.status}`,
  );
}

/**
 * Runs every check in order and returns the process exit code. A failure to
 * reach the app or the database (a rejected fetch, a rejected database
 * query, an unreachable host) is not caught by any check above, so it is
 * caught here: the script prints one line naming the error and exits
 * non-zero instead of crashing with an unhandled rejection.
 */
async function main(): Promise<number> {
  try {
    await checkReady();
    await checkData();
    const results = await askAll();
    await checkRejections();

    print("");
    print(
      renderGrid(
        results,
        QUESTIONS.map((question) => question.id),
        MODEL_KEYS,
      ),
    );
    const failedCells = results.filter((result) => !result.passed).length;
    return failedChecks + failedCells === 0 ? 0 : 1;
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    print(`FAIL  e2e could not run (${name})`);
    return 1;
  }
}

process.exit(await main());
