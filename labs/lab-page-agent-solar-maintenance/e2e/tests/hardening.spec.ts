import { expect, test } from "@playwright/test";

const API = process.env.API_URL ?? "http://localhost:8080";

async function token(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post(`${API}/api/auth/login`, {
    data: { email: "rosa@example.com", password: "solar" },
  });
  return ((await res.json()) as { token: string }).token;
}

const body = {
  model: "a-model-the-client-picked",
  messages: [
    { role: "system", content: "system" },
    { role: "user", content: "Current Page: [x](http://localhost:5173/sites)" },
  ],
};

test("an unauthenticated relay call is rejected", async ({ request }) => {
  const res = await request.post(`${API}/api/agent/v1/chat/completions`, {
    data: body,
  });
  expect(res.status()).toBe(401);
});

test("a forged session token is rejected", async ({ request }) => {
  const res = await request.post(`${API}/api/agent/v1/chat/completions`, {
    headers: { Authorization: "Bearer eyJhbGciOiJub25lIn0.e30." },
    data: body,
  });
  expect(res.status()).toBe(401);
});

test("the client cannot choose the model", async ({ request }) => {
  const res = await request.post(`${API}/api/agent/v1/chat/completions`, {
    headers: { Authorization: `Bearer ${await token(request)}` },
    data: body,
  });
  expect(res.ok()).toBe(true);
  const answered = (await res.json()) as { model: string };
  expect(answered.model).not.toBe("a-model-the-client-picked");
});

test("an oversized request is refused", async ({ request }) => {
  const res = await request.post(`${API}/api/agent/v1/chat/completions`, {
    headers: { Authorization: `Bearer ${await token(request)}` },
    data: {
      ...body,
      messages: [{ role: "user", content: "x".repeat(600_000) }],
    },
  });
  expect(res.status()).toBe(413);
});

test("the browser sends the session token and no model credential", async ({
  page,
}) => {
  const relayHeaders: Record<string, string>[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/agent/v1/"))
      relayHeaders.push(request.headers());
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("rosa@example.com");
  await page.getByLabel("Password").fill("solar");
  await page.getByRole("button", { name: "Sign in" }).click();
  // AgentMount installs window.pageAgent from a post-navigation effect, which
  // does not resolve within the click's own action wait; evaluating too early
  // races it and finds nothing to call.
  await page.waitForFunction(() => window.pageAgent !== undefined);
  await page.evaluate(async () => {
    await window.pageAgent!.execute("open the Almeria Roof Array site");
  });

  expect(relayHeaders.length).toBeGreaterThan(0);
  for (const headers of relayHeaders) {
    expect(headers.authorization).toMatch(/^Bearer eyJ/); // our JWT, not a provider key
    expect(JSON.stringify(headers)).not.toMatch(/AIza|sk-|x-goog-api-key/i);
  }
});
