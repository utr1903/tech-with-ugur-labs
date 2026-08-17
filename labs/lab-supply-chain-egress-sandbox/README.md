# Your package manager runs code at install time

A malicious package does not wait for you to `import` it. A Python source
distribution runs its `setup.py` the moment you `pip install` it — and that
code can read your environment and cloud credentials and send them off before
you ever call a single function. "I only installed it, I didn't run it" is not
safety.

This lab makes that leak visible, then contains it. Everything runs locally in
Docker; nothing touches the real internet, and the only secrets involved are
obviously fake.

Companion post: [Your Package Manager Runs Code at Install Time: a sandbox that
catches the credential grab](https://utr1903.github.io/tech-with-ugur-blog/posts/supply-chain-egress-sandbox/).

## What's inside
- `malicious-pkg/` — a benign-looking `friendly` package whose `setup.py`
  exfiltrates seeded fake credentials at install time.
- `mirror` — a local stand-in for a package index that serves the built sdist.
- `attacker` — the sink the package tries to phone home to.
- `proxy` — a ~100-line stdlib forward proxy that logs every outbound request
  and allows only the package source.
- Two installers: one on the open network, one inside the sandbox.

## Prerequisites
- Docker with Compose v2 (`docker compose version`)
- `make`

## Run it
```bash
make demo    # prints the side-by-side: leaked vs blocked
make test    # asserts the three outcomes, exits 0 on success
make clean   # tear everything down
```

## What you should see
`make demo` runs the same `pip install` twice:

- **Unsafe** (straight onto the open network): the install succeeds *and* the
  `setup.py` hook POSTs `AKIAFAKE000LABONLY` and friends to the attacker sink.
- **Safe** (inside the sandbox): the installer container has no route out
  except the proxy. pip fetches the package through the proxy (allowed), the
  package installs and imports fine — but the exfil POST is refused with `403`
  and logged as `DENY ... host=attacker`. Nothing reaches the sink.

## How the sandbox works
The safe installer sits on an `internal` docker network where the only
reachable host is the proxy, and `HTTP_PROXY` points at it. The proxy
default-denies everything and allow-lists only `mirror`. So the legitimate
package download goes through while the credential grab is blocked *and*
attributed to the exact host it tried to reach — the two things you want from
an install-time egress sandbox.

In npm this same class of hook is `preinstall`/`postinstall`; in production
you would reach for `mitmproxy` and TLS interception rather than a plain-HTTP
teaching proxy, but the recipe is identical: install untrusted dependencies in
a disposable container whose only egress path is a logging, default-deny proxy.

## SAFETY
The "malicious" package here is a teaching artifact and is deliberately inert
outside this lab:
- It POSTs only to the hardcoded local host `attacker`, which resolves only on
  this project's docker network — it can reach no real destination.
- It reads only three specifically-named, obviously-fake lab environment
  variables; it can steal no real secret.
- The whole lab runs offline on local docker networks. Read `malicious-pkg/
  setup.py` — the exfil is a dozen visible lines, not hidden.

Do not adapt this into anything that targets a real host. It exists to show you
the install-time execution channel so you can contain it.

## Clean up
```bash
make clean
```
