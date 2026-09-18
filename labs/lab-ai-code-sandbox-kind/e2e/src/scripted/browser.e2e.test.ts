import { describe, expect, it } from "vitest";
import { withPage } from "../support/browser.js";
import { CAFE_PROBLEM } from "../support/cafe.js";
import { WEB_URL } from "../support/cluster.js";

// Streamed text animates in, so every read waits for its element first.
const TIMEOUT = 120_000;

describe("browser", () => {
  it("shows the sandbox run and the answer table, restores both on reload, and starts a new chat", async () => {
    await withPage("browser-scripted", async (page) => {
      await page.goto(WEB_URL);
      await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/, { timeout: TIMEOUT });
      const chatUrl = page.url();

      await page.getByTestId("composer-input").fill(CAFE_PROBLEM);
      await page.getByTestId("composer-send").click();

      const card = page.getByTestId("code-executor-card").first();
      await card
        .getByTestId("tool-status")
        .filter({ hasText: "succeeded" })
        .waitFor({ timeout: TIMEOUT });
      expect(await card.getByTestId("tool-code").textContent()).toContain(
        "np.linalg.solve",
      );
      expect(await card.getByTestId("tool-stdout").textContent()).toContain(
        "solution:",
      );
      const table = page
        .getByTestId("assistant-message")
        .locator("table")
        .filter({ hasText: /sandwich\s*5/ })
        .first();
      await table.waitFor({ timeout: TIMEOUT });
      expect(await table.textContent()).toMatch(/coffee\s*3/);
      await page.screenshot({
        path: "reports/browser-scripted-answer.png",
        fullPage: true,
      });

      await page.reload();
      expect(page.url()).toBe(chatUrl);
      await page
        .getByTestId("user-message")
        .filter({ hasText: "Anna pays €13" })
        .waitFor({ timeout: TIMEOUT });
      await page
        .getByTestId("code-executor-card")
        .getByTestId("tool-status")
        .filter({ hasText: "succeeded" })
        .waitFor({ timeout: TIMEOUT });
      await page
        .getByTestId("assistant-message")
        .locator("table")
        .filter({ hasText: /sandwich\s*5/ })
        .first()
        .waitFor({ timeout: TIMEOUT });

      await page.getByTestId("new-chat").click();
      await page.waitForURL(
        (url) =>
          url.toString() !== chatUrl &&
          /\/chat\/[0-9a-f-]{36}$/.test(url.pathname),
        { timeout: TIMEOUT },
      );
      await page.getByTestId("composer-input").waitFor({ timeout: TIMEOUT });
      expect(await page.getByTestId("user-message").count()).toBe(0);
    });
  });
});
