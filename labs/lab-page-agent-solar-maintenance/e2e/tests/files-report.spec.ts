import { expect, test } from "@playwright/test";

const TASK =
  "replaced the string 3 inverter fan on the Almeria roof array this morning, " +
  "took two hours, panel 14 still shows a hotspot";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("rosa@example.com");
  await page.getByLabel("Password").fill("solar");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sites$/);
}

test("the agent navigates the app and files the report", async ({ page }) => {
  const origins = new Set<string>();
  page.on("request", (request) => origins.add(new URL(request.url()).origin));

  await signIn(page);

  // Return only the flag: ExecutionResult carries the whole history, and
  // Playwright would serialise all of it across the bridge for nothing.
  const success = await page.evaluate(
    async (task) => (await window.pageAgent!.execute(task)).success,
    TASK,
  );
  expect(success).toBe(true);

  // It got there by clicking, not by being told a URL.
  await expect(page).toHaveURL(/\/reports$/);

  // Nothing left the app's own origin.
  expect([...origins]).toEqual([new URL(page.url()).origin]);

  const row = page.locator("li[data-report-id]").first();
  await expect(row).toContainText("String 3 inverter");
  await expect(row).toContainText("Inverter");
  await expect(row).toContainText(todayISO());
  await expect(row).toContainText("2h");
  await expect(row).toContainText("Panel 14 still shows a hotspot.");
});
