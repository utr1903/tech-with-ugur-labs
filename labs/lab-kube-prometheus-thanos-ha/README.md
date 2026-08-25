# Thanos in front of a sharded, replicated Prometheus

Prometheus doesn't scale horizontally by itself. Add a second replica for
high availability and every query that hits both of them sees every series
twice. Shard the target list to spread scrape load across servers and every
query that hits only one shard sees a slice of the truth and calls it
complete. Both are real failure modes teams hit the first time they try to
grow past a single Prometheus server — and both are silent: nothing errors,
the dashboards just quietly lie.

This lab builds both failure modes on purpose — two shards, two replicas
each, no Thanos in the wiring path — puts Thanos Query in front of them,
and then *proves* the fix works instead of just asserting it. An automated
TypeScript verifier compares real query results between a plain, unscaled
Prometheus and the sharded-and-replicated one behind Thanos, counts raw vs.
deduplicated series to show the duplication is really being collapsed, and
kills a Prometheus replica and a Thanos Query replica mid-run to prove the
answers stay complete while a pod is down.

Companion post: [When One Prometheus Isn't Enough: Sharding, Replication, and Thanos — Proven Side by Side](https://techwithugur.dev/posts/kube-prometheus-thanos-ha/).

## Contents
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [The four proofs](#the-four-proofs)
- [How it's wired](#how-its-wired)
- [Grafana tour](#grafana-tour)
- [Where to go next](#where-to-go-next)

## Architecture

One kind cluster, two independent kube-prometheus-stack installs, and a
Thanos Query pair reading from the second install's sidecars:

```
            kind cluster "lab-thanos" (1 control-plane + 2 workers, kindest/node:v1.36.1)

host ports, mapped straight through by kind:
                       30900                     30901 / 30902               30903            30904
                         |                        |          |                 |                |
                         v                        v          v                 v                v

             +------------------------+   +-------------------------+   +--------------+   +---------+
             | ns: monitoring-vanilla |   | ns: monitoring-thanos   |   | Thanos Query |   | Grafana |
             |                        |   |                         |   | (2 pods)     |   | (1 pod) |
             | kps-vanilla Prometheus |   | shard 0: 2 replicas     |   +--------------+   +---------+
             | (1 pod, no sidecar)    |   |   each + Thanos sidecar |
             +------------------------+   | shard 1: 2 replicas     |
                                          |   each + Thanos sidecar |
                                          +-------------------------+

                                           gRPC StoreAPI (all 4 sidecars) ---->
                                           re-resolved via DNS-SD every 5s
```

`monitoring-vanilla` is the control group: one Prometheus server, no
sharding, no replication, no Thanos — the setup most teams start with.
`monitoring-thanos` runs the same workload split across 2 shards × 2
replicas (4 Prometheus pods, each with a Thanos sidecar exporting its data
over gRPC), fronted by a 2-replica Thanos Query deployment — also in
`monitoring-thanos` — that talks to all four sidecars and presents them as
one logical Prometheus API. Grafana lives in that same namespace too.

## Prerequisites

- Docker
- [kind](https://kind.sigs.k8s.io/)
- kubectl
- [Helm](https://helm.sh/)
- Node 22 + npm

| Component                | Version              |
|---------------------------|----------------------|
| kind node image           | `kindest/node:v1.36.1` (Kubernetes 1.36) |
| kube-prometheus-stack chart | `88.5.4`            |
| Thanos                    | `v0.42.4`            |
| Node.js (for the verifier)| `22`                 |

This runs five Prometheus servers (1 vanilla + 4 sharded/replicated) and
two Thanos Query replicas on one machine, plus two operators, two
node-exporter DaemonSets, and Grafana. It's light per-pod (each Prometheus
requests 100m CPU / 400Mi memory) but there are a lot of pods — budget
roughly 4 GiB of free RAM headroom for Docker before starting.

## Quickstart

```bash
make up       # kind cluster + both stack installs + Thanos Query + dashboard (~2 min with images cached, longer on a first pull)
make verify   # readiness, equivalence, partiality, dedup, failover, Grafana checks (~3 min, kills pods on purpose)
make down     # delete the cluster (a few seconds)
```

`make e2e` chains all three, so a fresh clone only needs one command. If
`make verify` fails, `make e2e` stops before `down` and leaves the cluster
running — useful for poking at it while debugging; run `make down`
yourself when you're done.

| Port    | What's there                                    |
|---------|--------------------------------------------------|
| `30900` | Vanilla Prometheus (`monitoring-vanilla`)         |
| `30901` | Prometheus shard 0, raw (`monitoring-thanos`)     |
| `30902` | Prometheus shard 1, raw (`monitoring-thanos`)     |
| `30903` | Thanos Query (2 pods behind one NodePort)         |
| `30904` | Grafana                                           |

All five are plain `http://127.0.0.1:<port>` — no port-forwarding needed,
kind maps them straight through to the host.

## The four proofs

`make verify` runs a small TypeScript verifier (`verifier/`) against the
live cluster. After a readiness check (every node-exporter target is
scraped, all 4 Thanos sidecar stores report healthy), it runs four proofs,
each one polling until it passes or its timeout expires:

**Equivalence** — the vanilla stack and the Thanos-fronted stack are asked
the same six questions about the cluster (`count(node_uname_info)`,
`count(up{job="node-exporter"} == 1)`, `sum(node_memory_MemTotal_bytes)`,
`sum(node_memory_MemAvailable_bytes)`,
`sum(rate(node_cpu_seconds_total{mode!="idle"}[2m]))`, and
`sum(rate(container_cpu_usage_seconds_total{namespace="kube-system"}[2m]))`),
evaluated at the same timestamp against both. Counts and memory totals must
match exactly; rate-based numbers are allowed a small tolerance since the
two stacks scrape on independent schedules. A match proves that sharding
and replicating the collection layer changed nothing about the answers a
query gets — Thanos Query is queried with `dedup=true&partial_response=false`
throughout, so a passing equivalence check is also implicitly the first
proof that dedup isn't hiding a real gap.

**Partiality** — `count(up)` is run directly against shard 0 and shard 1
(bypassing Thanos, hitting NodePorts 30901/30902), then against Thanos
Query with dedup and partial-response protection on. The check asserts
each shard sees a *strict, non-empty* subset of the targets and that the
two shard counts sum exactly to the Thanos total. This is the sharding
failure mode made visible on purpose: ask either raw shard "how many
targets are up?" and you get a wrong, partial answer; ask Thanos Query the
same question and you get the whole cluster.

**Dedup** — `up{job="node-exporter"}` is queried twice against Thanos
Query: once with `dedup=false` (raw) and once with `dedup=true`. With 3
kind nodes and 2 replicas per shard, the raw view returns **6 series** —
every node-exporter instance shows up once per replica of the shard that
scrapes it, each one carrying a distinct `prometheus_replica` label. The
deduplicated view returns exactly **3 series**, one per instance, with no
duplicates and no drops. That 6-to-3 collapse is the replication failure
mode and its fix side by side in one command.

**Failover** — this is where pods actually die. The verifier deletes one
Prometheus replica pod (`prometheus-kps-thanos-prometheus-1`) via the
Kubernetes API, waits for the deletion to actually take effect, then polls
Thanos Query every couple of seconds for up to 90 seconds while the
replica is down: `count(up{job="node-exporter"} == 1)` and a gapless
60-second range query. Errors during the brief window before Thanos' DNS
service discovery drops the dead store are tolerated — what's never
tolerated is a *successful* answer with data missing, which would mean
Thanos was silently lying about completeness. The same test then repeats
against one of the two Thanos Query pods itself, killed and watched the
same way. Both proofs pass only if every successful answer during the
outage was complete; the verifier waits for the killed pod to come back
healthy before moving on.

## How it's wired

`helm/values-vanilla.yaml` and `helm/values-thanos.yaml` install the same
chart version into separate namespaces with almost the same overrides
(operator watching only its own namespace, admission webhooks and the
chart's built-in Kubernetes-component targets disabled since kind doesn't
expose them). The interesting differences are all in one file:

| | `values-vanilla.yaml` | `values-thanos.yaml` |
|---|---|---|
| `prometheus.prometheusSpec.shards` | *(unset — 1)* | `2` |
| `prometheus.prometheusSpec.replicas` | *(unset — 1)* | `2` |
| `prometheus.prometheusSpec.thanos` | *(unset — no sidecar)* | `image: quay.io/thanos/thanos:v0.42.4` |
| `prometheus.thanosService.enabled` | *(unset)* | `true` — headless gRPC service across all 4 sidecars |
| `crds.enabled` | *(unset — installs CRDs)* | `false` — the vanilla release already installed them |
| `grafana.enabled` | `false` | `true` — the comparison Grafana lives in this install |

Both operators run with `prometheusOperator.namespaces.releaseNamespace:
true`, so `kps-vanilla`'s operator only ever reconciles objects in
`monitoring-vanilla` and `kps-thanos`'s operator only ever reconciles
`monitoring-thanos` — the two installs can't step on each other even
though they share a cluster. The second install sets `crds.enabled: false`
because kube-prometheus-stack's CustomResourceDefinitions are
cluster-scoped, not namespaced: the vanilla install already put them in
place cluster-wide, so the second install only needs the workloads that
use them, not another copy of the definitions themselves.

`node-exporter` runs as a DaemonSet on host networking, so it binds a port
on every kind node directly — both installs' node-exporters would
collide on the default `9100` if left alone. `values-thanos.yaml` moves
its instance to `9101` (`prometheus-node-exporter.service.port` and
`.targetPort`) so both DaemonSets can run side by side on the same three
nodes without either one failing to bind.

`thanos/query.yaml` and `thanos/shard-services.yaml` are raw manifests,
not part of either Helm release — Thanos Query isn't a kube-prometheus-stack
component, and the two per-shard NodePort services exist purely so the
verifier (and you) can query shard 0 and shard 1 directly for the
partiality proof. Thanos Query finds all four sidecars through
`--endpoint=dnssrv+_grpc._tcp.kps-thanos-thanos-discovery.monitoring-thanos.svc.cluster.local`,
the headless service the chart creates from `thanosService.enabled: true`,
re-resolved every 5 seconds (`--store.sd-dns-interval=5s`). The flag that
makes the whole dedup story work is
`--query.replica-label=prometheus_replica`: every Prometheus server in the
sharded install stamps its own external label
(`prometheus_replica=$(POD_NAME)`, set by the operator per-replica) onto
every series it produces, and telling Thanos Query which label *is* the
replica label is what lets it collapse two copies of the same series into
one instead of treating them as genuinely different time series.

## Grafana tour

Open <http://127.0.0.1:30904> and log in as `admin`. Grafana's admin
password is generated at install time and stored in a secret:

```bash
kubectl get secret -n monitoring-thanos kps-thanos-grafana \
  -o jsonpath='{.data.admin-password}' | base64 -d
```

The **Vanilla vs Thanos — same questions, same answers** dashboard (the
only one provisioned) has three paired panels: nodes seen, busy CPU cores,
and available memory, each rendered once against the `Vanilla Prometheus`
datasource and once against `Thanos Query`. With everything healthy the
two sides of every pair track each other — visual confirmation of the
equivalence proof, updating live instead of printed once by the verifier.

Both datasources are provisioned explicitly (`vanilla-prom`,
`thanos-query`, with Thanos Query set as the default), and the chart's
usual auto-provisioned default datasource is turned off
(`grafana.sidecar.datasources.defaultDatasourceEnabled: false`). That's
deliberate: the chart's default `kps-thanos-prometheus` Service selects
on `app.kubernetes.io/name` and `operator.prometheus.io/name`, neither of
which is shard-specific —
it load-balances across all 4 raw Prometheus pods from both shards at
once, so the auto-datasource would silently send each dashboard query to
a different, unpredictable one of them and return whichever shard's
partial target list that pod happens to hold. That's the exact broken,
partial-view pattern this whole lab exists to demonstrate; a Grafana
dashboard that accidentally reproduces it would undercut the point of
building Thanos Query in the first place.

## Where to go next

This lab deliberately stops at sidecar + Query: it proves querying across
shards and replicas works, but every Prometheus server still only retains
2 hours locally, so retention is exactly as it would be for any single one
of the five servers running here. The natural next step is object storage
— pointing the sidecars at a bucket, adding a Store Gateway to query
historical blocks straight out of that bucket, and a Compactor to merge
and downsample them — which is what turns this into unlimited-retention,
long-term Prometheus storage instead of just a wider query surface over
the same short window.
