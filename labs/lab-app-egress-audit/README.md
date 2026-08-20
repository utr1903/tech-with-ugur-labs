# Is that app you just installed phoning home?

You download a free tool and it works. But what is it talking to in the
background? This lab builds an egress-inspection gateway from OSS parts —
mitmproxy in transparent mode plus a DNS-logging resolver — and forces a
"freshly downloaded app" through it *without configuring the app*. Then it reads
back exactly what the app leaked, and where the visibility ends.

Everything runs locally in Docker. Nothing touches the real internet, and the
only "secret" the app exfiltrates is an obviously-fake canary.

## Prerequisites
- Docker with Compose v2 (`docker compose version`)
- `bash` (for the `./e2e.sh` gate)

## Run it
```bash
docker compose up --build --abort-on-container-exit --exit-code-from analyzer
```
Or run the asserting end-to-end gate, which also verifies the findings and tears
everything down:
```bash
./e2e.sh
```

## What you should see
The analyzer prints a per-domain verdict table and writes `report.json`:

| FQDN | Verdict | Evidence layer | What it means |
|------|---------|----------------|----------------|
| `updates.goodvendor.lab` | clean | decrypted HTTP | the legit update check — visible and benign |
| `cdn-metrics.tracklab.lab` | malicious | decrypted HTTP | covert beacon, host fingerprint captured in full |
| `telemetry.adnexus.lab` | malicious | decrypted HTTP | second covert beacon, same fingerprint payload |
| `pin.evil-c2.lab` | malicious | SNI-only (opaque) | certificate-pinned — we see *where*, not *what* |

The two beacons carry the canary `FAKE-FP-000-lab-only`; the pinned connection
refuses the gateway's certificate, so its payload stays hidden — but the
destination is still a finding.

## How it works
- **`suspect-app`** never knows it is being watched. It shares the gateway's
  network namespace, so every TCP connection it opens is transparently
  redirected into mitmproxy at the packet level — the app is never handed a
  proxy setting. It points its own resolver at the lab DNS.
- **`dns`** (dnsmasq) resolves every `.lab` name and logs every query — the DNS
  visibility layer.
- **`gateway`** (mitmproxy, transparent mode) redirects tcp 80/443 into itself
  and records three things: the SNI of every TLS connection, the full decrypted
  request where the app trusts its CA, and the handshakes the app rejects.
- **`webhost`** plays both the vendor and the attacker sink.
- **`analyzer`** merges the DNS log and the mitmproxy capture, matches every
  observed FQDN against a committed threat-intel blocklist
  (`threat-intel/blocklist.hosts`), and writes the verdict report.

The lesson in the last row: certificate pinning blocks payload inspection, but
an opaque connection to a domain on your blocklist is itself the alert — and
blocklist matching on FQDNs works at every layer, decrypted or not.

## SAFETY
This is a teaching lab and is inert outside itself:
- Every destination is a `.lab` name resolved only by the in-lab DNS to the
  in-lab webhost. There is no real host, no real DNS, no internet egress.
- The exfiltrated "host fingerprint" is a hardcoded fake (`FAKE-FP-000-lab-only`);
  the app reads nothing real from your machine. Read `suspect-app/src/` — the
  beacon is a few visible lines.
- The blocklist contains only the lab's own `.lab` names and non-routable
  `.invalid` placeholders.

Do not point the suspect app at anything real. It exists to show you how to
audit an app's egress so you can do it against software you actually distrust.

## Clean up
```bash
docker compose down -v
```
