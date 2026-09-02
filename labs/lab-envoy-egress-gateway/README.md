# Where is your outbound traffic actually going?

Almost every production network has a carefully argued story about *inbound*
traffic — a load balancer in front, a WAF, security groups reviewed line by
line. Ask the same team where their services are allowed to connect *out* to,
and the answer is usually a shrug and a default-allow route to the internet.
That asymmetry is not a theoretical problem: it is the path a data exfiltration
takes on its way out, and it is the path a surprise five-figure egress bill
takes on its way to the invoice. Nobody notices either one, because nothing is
counting.

This lab builds the missing control, small enough to run on a laptop. Two
workloads live on a private Docker network with `internal: true` — no gateway,
no route to the host, no route anywhere. One dual-homed Envoy container sits on
both that network and the network the destinations live on, so it is the only
door. It allow-lists by FQDN, answers everything else `403` itself, and meters
every byte that passes through, per destination, straight into Prometheus and
Grafana. Then it proves the control two different ways rather than asserting it.
Everything is offline: the "internet" is three mock HTTP servers in containers,
and every destination is a name under the reserved `example.com` documentation
domain, so nothing in this lab can resolve to or reach anything real.

> Companion post: [Where is your outbound traffic actually going? Build an Envoy egress gateway that routes and meters every request](https://techwithugur.dev/posts/envoy-egress-gateway/)

## Contents
- [Prerequisites](#prerequisites)
- [Run it](#run-it)
- [What you should see](#what-you-should-see)
- [How it works](#how-it-works)
  - [Three networks, one door](#three-networks-one-door)
  - [The allow-list is route config](#the-allow-list-is-route-config)
  - [Proving the control](#proving-the-control)
  - [Reading the meter](#reading-the-meter)
  - [The per-request ledger](#the-per-request-ledger)
  - [Component by component](#component-by-component)
- [The honest limits](#the-honest-limits)
- [Clean up](#clean-up)

## Prerequisites
- Docker with Compose v2 (`docker compose version`)
- `curl` and `jq` — for the example queries below
- `bash` and `awk` as well — `./e2e.sh` needs those two on top of `curl`, `jq`
  and `docker inspect`

No cloud account and no internet access at run time. Every destination is a
container.

## Run it

```bash
docker compose up -d --build
```

Detached on purpose: nothing in this stack drives an exit, and every command on
the rest of this page needs the stack alive and your shell back. Only the two
workloads finish — they run for 120 seconds and exit. The gateway, the three
destinations, Prometheus and Grafana all stay up.

Follow the run. This returns on its own the moment both workloads exit, which
is the point at which the gateway has counted everything it is going to count:

```bash
docker compose logs -f client-checkout client-batch
```

Then look at it:

- <http://localhost:3000> — Grafana, the **Egress gateway** dashboard. Anonymous
  viewer access is on, so there is no login.
- <http://localhost:9090> — Prometheus, if you want to poke at the raw series.

Or, instead of the walkthrough above, run the asserting end-to-end gate — the
whole thing unattended. It resets to a clean stack first, waits out the full
run, makes 22 assertions about the claims on this page that can be asserted, and
tears everything down again when it is finished.

```bash
./e2e.sh
```

It exits non-zero if any assertion fails, and takes about two and a half
minutes at the default run length once the images are built — the first run
adds the build on top of that. It removes its stack on the way out, so if you
run the gate first, get back to a finished run before working through the rest
of this page — bring the stack up again and follow it to the end:

```bash
docker compose up -d --build
docker compose logs -f client-checkout client-batch
```

Every number and log line printed further down came from a default 120-second
run. If you want a longer one, turn the knob — and wait it out the same way,
because the summaries and the totals below are only final once both workloads
have exited:

```bash
RUN_SECONDS=600 docker compose up -d --build
docker compose logs -f client-checkout client-batch
```

That recreates the two workloads and nothing else: `egress-proxy` keeps running,
carrying the counters and the access log of the run before it. Tear the stack
down with `docker compose down -v` first if you want the counts further down
this page to describe a single run.

## What you should see

The dashboard has nine panels, in three rows.

| Panel | What it answers |
|---|---|
| Requests through the gateway | how many requests left the workload network at all |
| Bytes received from destinations | the number an egress bill is actually computed from |
| Distinct destinations | how many places these workloads talk to — three, and only three |
| Denied egress attempts | how often something tried to leave for somewhere off the allow-list |
| Requests per second by destination | the shape of each workload's traffic over time |
| Bytes per second by destination | the same, in bytes, split into `in` and `out` per destination |
| Share of egress volume | which destination owns the bill, as a proportion |
| Response body size by destination (p50 / p95) | how big a typical response from each destination is |
| Denied egress attempts over time | *when* the denials happened, not just that they did |

Four things happen in every run, and each one shows up somewhere different:

| What the workload does | What happens | Where you see it |
|---|---|---|
| Requests its allow-listed destinations on a timer | `200`, forwarded to the matching cluster | the per-destination request and byte panels; `route_name` in the access log |
| Requests `exfil.shadow-analytics.example.com` | `403 egress denied: destination not in allow-list`, answered by the gateway, never forwarded | the two denial panels; `denied_route` with a `null` cluster in the access log |
| Tries to open a raw TCP connection to `payments-direct.example.com:8080`, with no gateway in the path | blocked at the DNS stage with `ESERVFAIL` — the name does not resolve on the workload network | the workload's own summary; **nothing** in the access log |
| Moves wildly different volumes per destination | telemetry ≫ CDN > payments in total bytes, off per-response payloads an order of magnitude apart | *Share of egress volume* |

Each workload prints a structured summary of its own run just before it exits:

```bash
docker compose logs --no-log-prefix client-checkout | jq -R 'fromjson? | select(.msg == "Egress run summary.")'
```

```json
{
  "level": 30,
  "time": "2026-09-02T11:34:04.941Z",
  "appName": "client",
  "client": "client-checkout",
  "totalSuccesses": 124,
  "successesByDestination": {
    "api.payments.example.com": 119,
    "assets.cdn.example.com": 5
  },
  "bytesByDestination": {
    "api.payments.example.com": 243712,
    "assets.cdn.example.com": 327680
  },
  "deniedCount": 1,
  "failureCount": 0,
  "denied": {
    "url": "http://exfil.shadow-analytics.example.com/collect",
    "status": 403,
    "bodyPreview": "egress denied: destination not in allow-list\n"
  },
  "bypass": {
    "host": "payments-direct.example.com",
    "blocked": true,
    "stage": "dns",
    "code": "ESERVFAIL"
  },
  "msg": "Egress run summary."
}
```

That is the client's own bookkeeping. The interesting part is that the gateway's
independent count agrees with it — `./e2e.sh` asserts exactly that, comparing
`sum(envoy_cluster_upstream_rq_total)` against what the two workloads report. A
control you cannot reconcile against the thing it controls is not a control.

## How it works

### Three networks, one door

The whole lab rests on one compose keyword:

```yaml
networks:
  # The private workload subnet. `internal: true` means Docker creates no
  # gateway for it: containers attached to it have no route to the host, to
  # other networks, or to the internet. This is what makes the whole lab honest
  # - the workloads are not merely configured to use the proxy, they have no
  # alternative.
  workload_net:
    internal: true
  # The far side of the gateway, standing in for the internet.
  egress_net:
  # Operations: the gateway's admin interface, Prometheus and Grafana. A fixed
  # subnet lets egress-proxy take a stable address here so Envoy's admin
  # listener can bind to it specifically instead of every interface.
  ops_net:
    ipam:
      config:
        - subnet: 10.30.0.0/24
```

`internal: true` tells Docker not to create a gateway interface for the bridge.
A container on `workload_net` therefore has no default route at all: not to the
internet, not to the host, not to another Docker network. The two workloads are
attached to `workload_net` and nothing else — no `ports:`, no second network, no
`network_mode`.

`egress-proxy` is the only container on more than one traffic network. It joins
`workload_net` (where the workloads can reach it by name) *and* `egress_net`
(where the destinations live), which is precisely what makes it a gateway rather
than a suggestion. Nothing else bridges the two.

The third network, `ops_net`, carries only the observability plane: Envoy's
admin interface, Prometheus and Grafana. It exists so the gateway's statistics
can be scraped without ever exposing that interface to the workloads — see
[the honest limits](#the-honest-limits) for what that costs.

That `10.30.0.0/24` is hardcoded, and if your machine already routes that range
— a VPN, another Docker network — `docker compose up` stops with `Pool overlaps
with other one on this address space`. Moving it means moving it everywhere it
is written down, because all of them have to agree: the subnet and
`egress-proxy`'s `ipv4_address` in `compose.yaml`, the address its healthcheck
dials in the same file, the admin listener's bind address in `proxy/envoy.yaml`,
and the probe in `e2e.sh`.

### The allow-list is route config

There is no allow-list file and no plugin. The allow-list *is* the gateway's
HTTP route table, in `proxy/envoy.yaml`. One virtual host per permitted
destination, matched on the request's `:authority`:

```yaml
                    - name: payments
                      domains: ["api.payments.example.com", "api.payments.example.com:*"]
                      routes:
                        - name: payments_route
                          match: { prefix: "/" }
                          route: { cluster: payments }
```

and one cluster naming where that destination actually is:

```yaml
    - name: payments
      type: STRICT_DNS
      connect_timeout: 2s
      track_cluster_stats: { request_response_sizes: true }
      load_assignment:
        cluster_name: payments
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address: { address: api.payments.example.com, port_value: 8080 }
```

`STRICT_DNS` means Envoy resolves that name itself, on `egress_net`, and keeps
the resolution fresh. `track_cluster_stats: { request_response_sizes: true }` is
what makes Envoy emit the per-destination body-size histograms the dashboard
draws.

Everything that did not match one of the three destination virtual hosts falls
through to the last one, whose `domains` is `["*"]`:

```yaml
                    # Default deny. Anything that did not match a virtual host
                    # above is answered here by the gateway itself and never
                    # reaches any upstream.
                    - name: denied
                      domains: ["*"]
                      routes:
                        - name: denied_route
                          match: { prefix: "/" }
                          direct_response:
                            status: 403
                            body:
                              inline_string: "egress denied: destination not in allow-list\n"
```

`direct_response` means the gateway writes that answer itself. There is no
cluster behind `denied`, so an off-list request has nowhere it *could* be
forwarded even if the route were misconfigured — the failure mode of a typo is
"denied", not "silently allowed".

Adding a destination is those two blocks and nothing else: a virtual host and a
cluster. That is the whole change-management story for this control, which is a
large part of why it is worth building on route config rather than on a
bespoke filter.

### Proving the control

Configuring a workload to use a proxy proves nothing — an attacker who owns the
process simply does not use it. So both workloads spend part of every run trying
to get out *around* the gateway, and the lab checks that they cannot.

**By name.** Each workload resolves `payments-direct.example.com` and tries to
open a plain TCP connection to port 8080. That name is a second network alias on
the `upstream-payments` container, so the destination really is there — but it
is on `egress_net`, and the workload is on `workload_net`, where Docker's
embedded DNS will not answer for it. The attempt dies before a single packet
is addressed to the destination:

```json
"bypass": { "host": "payments-direct.example.com", "blocked": true, "stage": "dns", "code": "ESERVFAIL" }
```

`payments-direct.example.com` is also *deliberately absent* from the gateway's
route config. It is not on the allow-list and it is not a cluster, so if that
name ever appeared in the gateway's access log it would mean a workload had
found a route the lab did not intend. Its absence from the log is therefore
evidence, and `./e2e.sh` asserts it:

```bash
docker compose logs egress-proxy | grep -c 'payments-direct.example.com' || true
```

```
0
```

**By raw IP.** DNS is the easy layer to blame, so `./e2e.sh` goes one step
further, and so can you: read the destination container's actual address off
`egress_net`, then run a probe on the workload network that connects to that
literal address with no name resolution involved at all.

```bash
ip=$(docker inspect -f '{{ (index .NetworkSettings.Networks (printf "%s_egress_net" (index .Config.Labels "com.docker.compose.project"))).IPAddress }}' "$(docker compose ps -q upstream-payments)")
docker compose run --rm --no-deps -T client-checkout npm run bypass-probe -- "$ip" 8080
```

```
> lab-envoy-egress-gateway-client@1.0.0 bypass-probe
> tsx src/index.ts bypass-probe 172.21.0.2 8080

{"level":30,"time":"2026-09-02T11:34:23.777Z","appName":"client","ip":"172.21.0.2","port":8080,"msg":"Probing a destination by raw IP address..."}
{"level":30,"time":"2026-09-02T11:34:23.778Z","appName":"client","ip":"172.21.0.2","port":8080,"blocked":true,"stage":"connect","code":"ENETUNREACH","msg":"Bypass probe summary."}
```

That address is `upstream-payments`' own address on `egress_net`; the workload
addresses in the [access log](#the-per-request-ledger) further down are on
`workload_net`, a different subnet. Docker assigns both afresh every time the
networks are created, so neither will match yours.

The kernel rejects it with `ENETUNREACH` — *network is unreachable*. There is no
route, not a missing name, and nothing the process could have done differently.
That is the difference between a workload that has been asked to use the gateway
and a workload that has no alternative.

### Reading the meter

Envoy's admin interface renders its own statistics in Prometheus exposition
format, so there is no exporter and no sidecar anywhere in this lab: Prometheus
scrapes the gateway directly, every 5 seconds. Four statistics carry the whole
story. Run these against Prometheus on the host, once the stack is up and both
workloads have exited — and give it five more seconds first. The gateway's
counters are final the moment the workloads stop, but Prometheus only holds what
it has scraped, so for one more interval its copy is a few requests short of
theirs.

**How many requests went where.** `envoy_cluster_upstream_rq_total` counts
requests per cluster, and a cluster is a destination:

```bash
curl -sG --data-urlencode 'query=sum by (envoy_cluster_name) (envoy_cluster_upstream_rq_total)' \
  http://localhost:9090/api/v1/query | jq -r '.data.result[] | "\(.metric.envoy_cluster_name) \(.value[1])"'
```

```
cdn 12
payments 119
telemetry 11
```

Prometheus does not promise an order for the series in a result, so this and the
next two queries may come back arranged differently for you.

**How many bytes.** `envoy_cluster_upstream_cx_rx_bytes_total` is what came back
*from* each destination — the number an egress bill is computed from — and
`..._cx_tx_bytes_total` is what was sent to it:

```bash
curl -sG --data-urlencode 'query=sum by (envoy_cluster_name) (envoy_cluster_upstream_cx_rx_bytes_total)' \
  http://localhost:9090/api/v1/query | jq -r '.data.result[] | "\(.metric.envoy_cluster_name) \(.value[1])"'
```

```
cdn 788424
payments 263347
telemetry 5769005
```

Note the inversion: payments is by far the *chattiest* destination — 119
requests against telemetry's 11 — and by far the cheapest. Request counts and
bytes answer different questions, and only one of them is on the invoice.

**How big a typical response is.** `envoy_cluster_upstream_rs_body_size_bucket`
is a histogram, so quantiles come out of it:

```bash
curl -sG --data-urlencode 'query=histogram_quantile(0.5, sum by (envoy_cluster_name, le) (rate(envoy_cluster_upstream_rs_body_size_bucket[5m])))' \
  http://localhost:9090/api/v1/query | jq -r '.data.result[] | "\(.metric.envoy_cluster_name) \(.value[1])"'
```

```
cdn 49152
payments 1536
telemetry 393216
```

Those are interpolations *within* the bucket that contains each exact payload
(2048, 65536 and 524288 bytes), which is the best a histogram can do — and it is
only that good because the buckets were tuned. Envoy's default histogram buckets
are far too coarse to tell a 2 KB API response from a 512 KB upload; with them,
all three destinations land in the same bucket and the panel says nothing. The
`histogram_bucket_settings` block at the top of `proxy/envoy.yaml` replaces them
with powers of two that bracket each of the three payload archetypes:

```yaml
  histogram_bucket_settings:
    - match:
        prefix: "cluster."
      buckets: [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576]
```

**How often the allow-list held.** Denials never reach a cluster, so they are
counted on the listener instead, by response-code class:

```bash
curl -sG --data-urlencode 'query=sum(envoy_http_downstream_rq_xx{envoy_http_conn_manager_prefix="egress",envoy_response_code_class="4"})' \
  http://localhost:9090/api/v1/query | jq -r '.data.result[0].value[1]'
```

```
2
```

Two — one per workload. The `egress` in that label is the `stat_prefix` the
HTTP connection manager is configured with — a statistics namespace, unrelated
to the listener's own `name`.

### The per-request ledger

Aggregate statistics are keyed by destination. They cannot tell you *which*
workload made a request, and during an incident that is usually the first thing
you want. So the gateway also writes one JSON line per request to stdout:

```bash
docker compose logs egress-proxy | grep '"authority"' | tail -n 5
```

```
egress-proxy-1  | {"authority":"api.payments.example.com","bytes_received":0,"bytes_sent":2048,"downstream":"172.18.0.3:56942","duration_ms":0,"response_code":200,"route_name":"payments_route","upstream_cluster":"payments"}
egress-proxy-1  | {"authority":"api.payments.example.com","bytes_received":0,"bytes_sent":2048,"downstream":"172.18.0.3:56942","duration_ms":1,"response_code":200,"route_name":"payments_route","upstream_cluster":"payments"}
egress-proxy-1  | {"authority":"api.payments.example.com","bytes_received":0,"bytes_sent":2048,"downstream":"172.18.0.3:56942","duration_ms":1,"response_code":200,"route_name":"payments_route","upstream_cluster":"payments"}
egress-proxy-1  | {"authority":"api.payments.example.com","bytes_received":0,"bytes_sent":2048,"downstream":"172.18.0.3:56942","duration_ms":1,"response_code":200,"route_name":"payments_route","upstream_cluster":"payments"}
egress-proxy-1  | {"authority":"api.payments.example.com","bytes_received":0,"bytes_sent":2048,"downstream":"172.18.0.3:56942","duration_ms":1,"response_code":200,"route_name":"payments_route","upstream_cluster":"payments"}
```

Five identical-looking lines, because at the tail of a run the once-a-second
payments traffic is all there is. Docker hands out a different subnet each time
the networks are created, so your addresses will not be these. Read one line
field by field:

| Field | Reads as |
|---|---|
| `authority` | the destination the workload asked for, exactly as it wrote it |
| `route_name` | which allow-list entry matched — `payments_route` here, `denied_route` for anything off-list |
| `upstream_cluster` | where it was forwarded; `null` when the gateway answered the request itself |
| `response_code` | `200` forwarded, `403` denied |
| `bytes_sent` / `bytes_received` | body bytes returned to the workload / received from it |
| `duration_ms` | how long the whole exchange took |
| `downstream` | **the workload's own address and port** — the only per-client identity in the record |

A denial looks like this, and shows both halves of that:

```bash
docker compose logs egress-proxy | grep 'shadow-analytics'
```

```
egress-proxy-1  | {"authority":"exfil.shadow-analytics.example.com","bytes_received":0,"bytes_sent":45,"downstream":"172.18.0.3:56942","duration_ms":0,"response_code":403,"route_name":"denied_route","upstream_cluster":null}
egress-proxy-1  | {"authority":"exfil.shadow-analytics.example.com","bytes_received":0,"bytes_sent":45,"downstream":"172.18.0.4:57080","duration_ms":0,"response_code":403,"route_name":"denied_route","upstream_cluster":null}
```

`route_name: denied_route` with `upstream_cluster: null` is the gateway saying
"I answered this myself, it went nowhere". Two lines, two different `downstream`
addresses: both workloads tried, and the log — not the dashboard — is what tells
them apart.

### Component by component

| Service | Image or build | Networks | What it is there to demonstrate |
|---|---|---|---|
| `egress-proxy` | `envoyproxy/envoy:v1.39.1` | `workload_net`, `egress_net`, `ops_net` (`10.30.0.10`) | The door and the meter: the only container bridging the workload network and the destinations, so every request is both routed and counted in one place. Its healthcheck talks to its own admin interface over bash's `/dev/tcp`, because the Envoy image ships neither `curl` nor `wget`. |
| `client-checkout` | build `./client` | `workload_net` | A chatty, small-request workload: `api.payments.example.com` every second, `assets.cdn.example.com` every 20. Many requests, few bytes. |
| `client-batch` | build `./client` | `workload_net` | The opposite shape: `telemetry.metrics.example.com` every 10 seconds, `assets.cdn.example.com` every 15. Few requests, most of the bytes. |
| `upstream-payments` | build `./upstream` | `egress_net` (aliases `api.payments.example.com`, `payments-direct.example.com`) | The small API destination — 2 KB per response. Its second alias is the bypass target, deliberately never allow-listed. |
| `upstream-cdn` | build `./upstream` | `egress_net` (alias `assets.cdn.example.com`) | The mid-sized asset destination — 64 KB per response. |
| `upstream-telemetry` | build `./upstream` | `egress_net` (alias `telemetry.metrics.example.com`) | The destination that quietly owns the bill — 512 KB per response, on the fewest requests of all. |
| `prometheus` | `prom/prometheus:v3.14.0` | `ops_net`, host `:9090` | Scrapes `egress-proxy:9901/stats/prometheus` every 5 seconds. No exporter, no sidecar — the gateway is the source. |
| `grafana` | `grafana/grafana:13.2.1` | `ops_net`, host `:3000` | The nine-panel **Egress gateway** dashboard, provisioned from `observability/grafana/`. Anonymous viewer access, so no login. |

All three destinations run the same image; only `DESTINATION_NAME` and
`PAYLOAD_BYTES` differ. Both workloads run the same image too; only
`REQUEST_PLAN` and `CLIENT_NAME` differ — and `CLIENT_NAME` is what every
per-workload line in the logs is keyed by. The network alias on each destination
is set to the FQDN it answers as, which is why the gateway's route config reads
exactly as it would in production.

## The honest limits

**The statistics cannot tell you which workload.** Every Envoy cluster
statistic is keyed by *destination*. `envoy_cluster_upstream_rq_total{envoy_cluster_name="cdn"}`
is the sum across both workloads and there is no label that splits it. Per-client
attribution in this lab comes from the access log's `downstream` field, one line
at a time — not from the dashboard. Getting it into the metrics as well means
something more: a per-workload listener, a header-derived label, or an
identity-aware sidecar. That is a real gap and it is where a production build of
this would spend its next week.

**This is plaintext HTTP forward proxying.** The workloads speak
absolute-form HTTP to the gateway, which is why the gateway can see the path,
route on the authority and measure the body sizes. Real egress is mostly HTTPS,
where a forward proxy gets a `CONNECT` tunnel and nothing more. The byte counts
and the destination survive that change — `CONNECT` names its target, and bytes
are bytes — but the paths and the per-response body-size histograms do not. To
keep those under TLS you need termination and a trusted CA in every workload,
which is a different, much heavier lab.

**`internal: true` is a private subnet, not a data perimeter.** It models one
real thing well: a subnet with no NAT gateway and no route out, which is exactly
how you would build this on a cloud provider. It does not model the rest of the
story. There is no DNS-level blocking here, no IAM condition restricting which
principals may call which service, no VPC endpoint policy, no inspection of what
happens *after* an allowed destination receives the data. A cloud data
perimeter is all of those layers together; this is the network one.

**The admin interface is exposed on purpose.** Envoy's admin interface is
unauthenticated and can do considerably more than serve statistics. This lab
binds it to `10.30.0.10:9901` on `ops_net` so Prometheus can scrape it: it is
unreachable from the workload network — `./e2e.sh` probes it from a workload and
asserts exactly that — and unreachable from your host, but it is reachable by
anything on the ops network. In production you bind admin to localhost and ship
statistics out through a stats sink instead, so nothing on any network can reach
it at all.

## Clean up

```bash
docker compose down -v
```
