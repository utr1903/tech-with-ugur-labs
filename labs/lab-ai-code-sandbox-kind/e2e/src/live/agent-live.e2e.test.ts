import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { withPage } from "../support/browser.js";
import {
  CAFE_PROBLEM,
  EXPECTED_PRICES,
  SECTION_HEADINGS,
} from "../support/cafe.js";
import { loadHistory, sendChat } from "../support/chat-client.js";
import { restartDeployment, WEB_URL } from "../support/cluster.js";
import { waitForHttp } from "../support/port-forward.js";
import {
  assistantText,
  toolInputs,
  toolOutputs,
} from "../support/ui-stream.js";

// Anchored to the coefficient's own letter so a restated data point (the
// least-squares problem includes the literal value "1.1") can never satisfy
// this on its own: the letter, then up to 20 non-pipe characters, then an
// "=" / "≈" / "is" / table "|" before the number.
const A_VALUE_PATTERN = /\ba\b[^\n|]{0,20}?(=|≈|is|\|)\s*1\.10?(?![0-9])/i;
const B_VALUE_PATTERN = /\bb\b[^\n|]{0,20}?(=|≈|is|\|)\s*1\.96(?![0-9])/i;

const ITEM_STEMS: Record<keyof typeof EXPECTED_PRICES, string> = {
  coffee: "coffee",
  tea: "tea",
  sandwich: "sandwich",
};

function expectSectionsInOrder(text: string): void {
  const positions = SECTION_HEADINGS.map((h) =>
    text.search(new RegExp(`^#{1,6}\\s*${h}\\b`, "im")),
  );
  expect(positions.every((p) => p >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
}

function expectPriceRows(text: string): void {
  const rows = text.split("\n").filter((line) => line.trim().startsWith("|"));
  for (const [item, price] of Object.entries(EXPECTED_PRICES)) {
    const stem = ITEM_STEMS[item as keyof typeof EXPECTED_PRICES];
    const row = rows.find((r) => r.toLowerCase().includes(stem));
    expect(row, `table row for ${item}`).toBeDefined();
    expect(row).toMatch(new RegExp(`(^|[^0-9.])${price}(\\.0+)?([^0-9]|$)`));
  }
}

function succeededRuns(chunks: Parameters<typeof toolOutputs>[0]) {
  return toolOutputs(chunks).filter((o) => o.output.status === "succeeded");
}

// Slices out one "### <Heading>" section (up to the next heading, or the
// end of the text) so a value can be asserted against only that section
// instead of the whole answer — the Model/Solver sections routinely restate
// the problem's own numbers, which must never satisfy a Solution assertion.
function extractSection(
  text: string,
  heading: (typeof SECTION_HEADINGS)[number],
): string {
  const index = SECTION_HEADINGS.indexOf(heading);
  const start = text.search(new RegExp(`^#{1,6}\\s*${heading}\\b`, "im"));
  if (start < 0) throw new Error(`section "${heading}" not found`);
  const next = SECTION_HEADINGS[index + 1];
  const end = next
    ? text.search(new RegExp(`^#{1,6}\\s*${next}\\b`, "im"))
    : -1;
  return text.slice(start, end < 0 ? text.length : end);
}

// The server ties the agent run to the request's AbortSignal and the web
// proxy forwards it, so reloading the page while a turn is still streaming
// aborts it before the final message is checkpointed. Poll the checkpoint
// itself (what a reload's history fetch reads) until the Verification
// section that ends every turn has actually landed there.
async function waitForFinishedTurn(
  threadId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await loadHistory(threadId);
    const assistant = messages.filter((m) => m.role === "assistant").at(-1);
    const text = (assistant?.parts ?? [])
      .filter((p) => p.type === "text")
      .map((p) => String((p as { text?: unknown }).text ?? ""))
      .join("");
    if (/^#{1,6}\s*Verification\b/im.test(text)) return;
    if (Date.now() >= deadline)
      throw new Error(
        `thread ${threadId} had no finished turn (no Verification section) within ${timeoutMs}ms`,
      );
    await sleep(1_000);
  }
}

describe("live model", () => {
  it("solves the café problem through code_executor with the four sections", async () => {
    const threadId = randomUUID();
    const chunks = await sendChat(threadId, CAFE_PROBLEM);
    expect(
      toolInputs(chunks).filter((c) => c.toolName === "code_executor").length,
    ).toBeGreaterThanOrEqual(1);
    expect(succeededRuns(chunks).length).toBeGreaterThanOrEqual(1);
    const text = assistantText(chunks);
    expectSectionsInOrder(text);
    expectPriceRows(text);

    const before = await loadHistory(threadId);
    await restartDeployment("server");
    await waitForHttp(`${WEB_URL}/api/tools`);
    expect(await loadHistory(threadId)).toEqual(before);
  });

  it("picks a fitting solver for a least-squares problem", async () => {
    const prompt =
      "Fit a straight line y = a + b·x by least squares to the points (0, 1.1), (1, 2.9), (2, 5.2), (3, 7.1) and (4, 8.8). What are a and b?";
    const chunks = await sendChat(randomUUID(), prompt);
    const code = toolInputs(chunks)
      .map((c) => String(c.input.code))
      .join("\n");
    expect(code).toMatch(
      /lstsq|polyfit|Polynomial\.fit|curve_fit|linregress|LinearRegression|least_squares|minimize/,
    );
    expect(succeededRuns(chunks).length).toBeGreaterThanOrEqual(1);
    const text = assistantText(chunks);
    expectSectionsInOrder(text);
    const solution = extractSection(text, "Solution");
    expect(solution).toMatch(B_VALUE_PATTERN);
    expect(solution).toMatch(A_VALUE_PATTERN);
  });

  it("renders the live run in the browser and restores it on reload", async () => {
    await withPage("browser-live", async (page) => {
      await page.goto(WEB_URL);
      await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/);
      const chatUrlMatch = page.url().match(/\/chat\/([0-9a-f-]{36})$/);
      if (!chatUrlMatch) throw new Error(`unexpected chat URL: ${page.url()}`);
      const threadId = chatUrlMatch[1] as string;
      await page.getByTestId("composer-input").fill(CAFE_PROBLEM);
      await page.getByTestId("composer-send").click();
      await page
        .getByTestId("tool-status")
        .filter({ hasText: "succeeded" })
        .first()
        .waitFor({ timeout: 240_000 });
      await page
        .getByTestId("assistant-message")
        .locator("table")
        .first()
        .waitFor({ timeout: 240_000 });
      await page.screenshot({
        path: "reports/browser-live-answer.png",
        fullPage: true,
      });
      // Wait for the turn to actually finish (Verification section
      // checkpointed) before reloading: reloading mid-stream would abort
      // the still-open request and the post-reload waits below would hang.
      await page
        .getByTestId("assistant-message")
        .filter({ hasText: "Verification" })
        .first()
        .waitFor({ timeout: 240_000 });
      await waitForFinishedTurn(threadId, 240_000);
      await page.reload();
      await page
        .getByTestId("code-executor-card")
        .first()
        .waitFor({ timeout: 60_000 });
      await page
        .getByTestId("assistant-message")
        .locator("table")
        .first()
        .waitFor({ timeout: 60_000 });
    });
  });
});
