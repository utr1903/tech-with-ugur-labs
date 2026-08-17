import { sanitizeCss } from "./sanitize.js";

interface RenderOpts {
  token: string;
  emailCss: string;
  secure: boolean;
}

// Escape a string for use inside a double-quoted HTML attribute (used for the
// iframe srcdoc in secure mode).
function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const SECRET_FORM = (token: string) =>
  `<form><label>Session <input name="csrf" value="${token}"></label></form>`;

export function renderMessage(opts: RenderOpts): {
  html: string;
  headers: Record<string, string>;
} {
  if (!opts.secure) {
    // Vulnerable: attacker CSS lives in the SAME document as the secret input,
    // with no CSP. Its attribute selectors can match the input's value.
    const html = `<!doctype html><html><head><meta charset="utf-8">
<style id="email">${opts.emailCss}</style>
</head><body>
<h1>Inbox</h1>
${SECRET_FORM(opts.token)}
<div class="message">You've got mail.</div>
</body></html>`;
    return { html, headers: {} };
  }

  // Secure: (1) sanitize the CSS, (2) render the untrusted email inside a
  // sandboxed iframe that does NOT contain the secret, and (3) send a CSP that
  // forbids external resource loads. Any one layer stops the leak.
  const emailDoc = `<!doctype html><html><head><meta charset="utf-8">
<style>${sanitizeCss(opts.emailCss)}</style></head><body>
<div class="message">You've got mail.</div></body></html>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<h1>Inbox</h1>
${SECRET_FORM(opts.token)}
<iframe sandbox="allow-same-origin" srcdoc="${attr(emailDoc)}"></iframe>
</body></html>`;
  const headers = {
    "content-security-policy":
      "default-src 'self'; img-src 'self'; style-src 'unsafe-inline'",
  };
  return { html, headers };
}
