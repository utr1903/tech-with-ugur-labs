import { randomUUID } from "node:crypto";
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
    expect(text).toMatch(/1\.96/);
    expect(text).toMatch(/(^|[^0-9])1\.10?([^0-9]|$)/);
  });

  it("renders the live run in the browser and restores it on reload", async () => {
    await withPage("browser-live", async (page) => {
      await page.goto(WEB_URL);
      await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/);
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
