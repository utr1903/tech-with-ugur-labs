import { mkdir } from "node:fs/promises";
import { type Browser, chromium, type Page } from "playwright";

// Runs one scenario in a fresh headless Chromium and keeps a full-page
// screenshot under reports/ when it fails.
export async function withPage<T>(
  name: string,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const browser: Browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
  });
  try {
    return await run(page);
  } catch (err) {
    await mkdir("reports", { recursive: true });
    await page.screenshot({
      path: `reports/${name}-failure.png`,
      fullPage: true,
    });
    throw err;
  } finally {
    await browser.close();
  }
}
