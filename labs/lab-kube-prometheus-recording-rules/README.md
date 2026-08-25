# Recording rules done right

kube-prometheus-stack on kind, customized the way real teams need it:
recording rules with human-readable node names, two dashboards that
prove why recording rules matter, and Grafana-managed alerts delivered
to your own webhook server — no Alertmanager in the picture.

## Contents
- [What this lab shows](#what-this-lab-shows)
- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Tour](#tour)
- [How it works](#how-it-works)
- [Caveats](#caveats)

## What this lab shows

Every panel in this lab exists twice: once built from raw PromQL joins
against `node_cpu_seconds_total` / `container_memory_working_set_bytes` /
etc, and once built from a recording rule that pre-computes the same
number under a clean name like `node:cpu_utilization:percent`. Same six
panels, same data, side by side in two dashboards — the point is to
*see* the difference recording rules make, not just read about it:
shorter queries, a `node=` label you can actually template a dashboard
variable on, and evaluation cost paid once by Prometheus instead of once
per dashboard load.

Alerting rides the same idea one step further. Instead of Prometheus
alerting rules routed through an Alertmanager, the six alerts here are
Grafana-managed: Grafana itself evaluates the condition (against the
recorded metrics) and fires straight to a contact point. There is no
Alertmanager in this cluster — `alertmanager.enabled: false` in the
Helm values — the routing that would normally live in Alertmanager's
config lives in Grafana's own notification policy instead.

Everything that shows up in Grafana — both dashboards, the six alert
rules, the contact point, the notification policy — is provisioned the
same way: a labeled `ConfigMap` that a Grafana sidecar container
notices and imports. Nothing is clicked into place by hand.

## Prerequisites

- Docker
- [kind](https://kind.sigs.k8s.io/) ≥ 0.29
- kubectl
- [Helm](https://helm.sh/) ≥ 3.14
- make, jq, curl

The lab pins everything else for you: kube-prometheus-stack chart
`88.5.4`, node image `kindest/node:v1.33.1`, and the webhook server on
Node 22 (built into its own image — no local Node install needed).

## Quickstart

```bash
make up       # kind cluster + chart + all lab resources (~10 min)
make verify   # end-to-end check, faults, and all six alerts (~10-15 min)
make down     # delete the cluster
```

`make e2e` chains all three in order, so a fresh clone only needs one
command.

`make verify` is the expensive step, and it's destructive by design:
partway through it deploys CPU/memory fault workloads sized off your
machine's actual capacity, and it stops the kubelet on one worker node
outright to make a node go `NotReady`. That's intentional — it's the
only way to prove the unhealthy-node and unhealthy-pod alerts actually
fire — but it means the cluster is not meant to survive `make verify`
as something you'd keep using afterwards. Run `make down` when you're
done, or just let `make e2e` do it for you.

## Tour

With the cluster up, port-forward Grafana:

```bash
kubectl port-forward -n monitoring svc/kps-grafana 3000:80
```

Grab the generated admin password:

```bash
kubectl get secret -n monitoring kps-grafana \
  -o jsonpath='{.data.admin-password}' | base64 -d
```

Log in at <http://localhost:3000> as `admin`, then open **Utilization —
raw queries** and **Utilization — recording rules** side by side (both
live in the default Grafana folder). Click the first panel's title →
**Edit** on each dashboard and compare the query editors: one is a
multi-line join across three raw metrics with a `label_replace` bolted
on; the other is `topk($worst_x, node:cpu_utilization:percent{node=~"$node"})`.
That one screenshot is the whole thesis of the lab.

## How it works

**`kind/`** — a three-node cluster (`cluster.yaml`): one control-plane,
two workers, all on `kindest/node:v1.33.1`. `node-monitor-grace-period`
is shortened to 20s on the control plane and each worker's
`node-status-update-frequency` to 4s, so a node that goes `NotReady`
during `make verify` is detected in seconds instead of the ~40s
default — the demo doesn't have to wait around for it.

**`helm/values.yaml`** — every override on top of chart defaults, each
commented in place:
- `defaultRules.create: false` — the chart ships dozens of stock
  alerting/recording rules; this lab turns them all off so the only
  rules present are the ones in `rules/`.
- `alertmanager.enabled: false` — alerting is Grafana-managed, so there
  is no Alertmanager in this cluster at all.
- `kubeControllerManager` / `kubeScheduler` / `kubeEtcd` / `kubeProxy`
  disabled — kind doesn't expose these as scrapeable targets, so
  leaving them on just leaves permanently-down targets in Prometheus.
- `prometheus.prometheusSpec.scrapeInterval` /
  `evaluationInterval: 15s` — fast enough that fault injection during
  `make verify` doesn't have to wait multiple minutes to be visible.
- `grafana.defaultDashboardsEnabled: false` — only this lab's two
  dashboards show up, not the chart's built-in fleet.
- `grafana.sidecar.dashboards` / `.alerts` — the two sidecars that
  watch for labeled `ConfigMap`s and import them. `sidecar.alerts` is
  **off by default in the chart**; turning it on is the key switch that
  makes Grafana-managed alerting via `ConfigMap` possible here at all.

**`rules/recording-rules.yaml`** — a `PrometheusRule` with two groups.
`lab.node.utilization` computes `node:cpu_utilization:percent` and
`node:memory_utilization:percent`; both start from node-exporter's raw
`instance` label (an `IP:port` scrape target) and use
`label_replace(... * on(instance) group_left(nodename) node_uname_info ...)`
to join in the human-readable node name from `node_uname_info` and
expose it as a plain `node` label. `node:unhealthy:info` flags any node
whose `Ready` condition isn't `true`, or that has `MemoryPressure` /
`DiskPressure` / `PIDPressure` set. `lab.pod.utilization` mirrors this
for pods: `pod:cpu_utilization_vs_limit:percent` and the memory
equivalent express usage as a percentage of the pod's own resource
*limit* (not raw usage), joined against `kube_pod_info` for the `node`
label; `pod:unhealthy:info` flags pods stuck waiting for a reason other
than `ContainerCreating` (i.e. actually broken, not just starting).

**`dashboards/`** — `raw-queries.json` (`lab-raw-queries`) and
`recorded-metrics.json` (`lab-recorded-metrics`), six matching panels
each: worst-N nodes by CPU%, worst-N nodes by memory%, worst-N pods by
CPU% of limit, worst-N pods by memory% of limit, unhealthy nodes,
unhealthy pods. Both dashboards define the identical five template
variables (`$node`, `$namespace`, `$worst_x`, `$cpu_threshold`,
`$mem_threshold`) — that's deliberate, not an oversight: it's what makes
the two dashboards comparable panel-for-panel. `$worst_x` drives the
`topk()` count on the four worst-N panels in both (the two unhealthy
panels have no topk); `$node` and `$namespace` filter
both dashboards' queries, just at different cost. The recorded-metrics
dashboard filters on the recorded metric's own clean `node=`/`namespace=`
label directly (`node:cpu_utilization:percent{node=~"$node"}`); the
raw dashboard reaches the same filter through the underlying join —
`node_uname_info{nodename=~"$node"}` for nodes,
`namespace=~"$namespace"` inlined into the raw metric selectors for
pods. Both work; the difference the twin dashboards exist to show is
query complexity and readability, not which variables are available.

**`alerting/`** — three provisioning files, each imported by the
Grafana alerts sidecar as its own labeled `ConfigMap`:
`alert-rules.yaml` defines the six alerts (`LabNodeCpuHigh`,
`LabNodeMemHigh`, `LabNodeUnhealthy`, `LabPodCpuHigh`, `LabPodMemHigh`,
`LabPodUnhealthy`), each an instant query against a recorded metric
feeding a `threshold` expression with a `for: 30s` window;
`contact-points.yaml` defines a single webhook contact point pointed at
`http://webhook-app.webhook-app.svc:8080/alerts`; `policies.yaml`
routes everything to that contact point, grouped by `alertname` with a
10s group wait.

**`webhook-app/`** — a small TypeScript HTTP server (`src/index.ts`,
`src/server/handler.ts`, `src/server/alert-payload.ts`) that exists
just to receive alerts and prove delivery: `GET /healthz` for the
readiness probe, `POST /alerts` which parses the Alertmanager-shaped
payload Grafana webhooks send and logs one structured line per alert
(`pino`, via `src/logger.ts`). `make verify` greps those logs for every
alert name it expects. Built into an image and side-loaded into kind
with `kind load docker-image` — nothing is pulled from a registry.
`manifests/webhook-app.yaml` is the Deployment/Service that runs it
(`imagePullPolicy: Never`, since the image only ever exists inside kind).

**`faults/`** — three Deployments in a dedicated `faults` namespace:
`cpu-hog` (`yes > /dev/null`, capped at 200m CPU), `mem-hog` (`dd`
fills a 110Mi tmpfs, capped at 128Mi memory), and `crashloop` (exits 1
five seconds after every start, to keep one pod permanently in
`CrashLoopBackOff` for `LabPodUnhealthy`). `cpu-hog` and `mem-hog`
start at `replicas: 1`; `scripts/verify.sh` scales them up at runtime
(see below).

**`scripts/`** — `up.sh`, `verify.sh`, `down.sh` are what the Makefile
calls; `lib.sh` holds shared logging/wait helpers; `apply-observability.sh`
packages every file under `dashboards/` and `alerting/` into a labeled
`ConfigMap` (`kubectl create configmap ... --dry-run=client | kubectl
label --local -f - <label>=1 | kubectl apply -f -`) so the sidecars
pick it up; `deploy-webhook-app.sh` builds and side-loads the webhook
image; `break-node.sh` stops the kubelet (`docker exec <node>
systemctl stop kubelet`) on whichever worker `verify.sh` tells it to.

## Caveats

- **Alert thresholds are literals; the dashboards' threshold
  variables aren't wired to anything.** `alerting/alert-rules.yaml`
  hardcodes `80` as the trigger for the four percent-based alerts —
  Grafana alerting has no way to read a dashboard variable into an
  alert condition, so there's no alternative. Both dashboards also
  define `$cpu_threshold` / `$mem_threshold` custom variables (default
  `80`, same literal, kept in sync by hand), but neither dashboard
  actually references them anywhere: every panel's `fieldConfig`
  threshold is its own separate hardcoded `80`, identical in both
  files. Changing `$cpu_threshold` in the Grafana UI does nothing to
  panel coloring — it's the same Grafana limitation (no templating
  fieldConfig thresholds from dashboard variables) stated from the
  dashboard side instead of the alert side. Of the five template
  variables, only `$worst_x` (the topk count) and `$node`/`$namespace`
  (query filters) actually do anything.
- **Pod utilization panels only cover pods with resource limits.**
  `pod:cpu_utilization_vs_limit:percent` and its memory equivalent are
  usage *as a percentage of the pod's own limit* — a pod with no CPU or
  memory limit set contributes no series to either recorded metric, or
  to the matching dashboard panels, and can't trip `LabPodCpuHigh` /
  `LabPodMemHigh` no matter how much it actually uses.
- **`defaultRules.create=false` means this cluster ships with none of
  the chart's stock alerts.** Every alert that exists here is one of
  the six in `alerting/alert-rules.yaml`; nothing from
  kube-prometheus-stack's normal out-of-the-box rule set (node down,
  disk filling up, etc.) is present.
- **`make verify` deploys faults and stops a kubelet — the cluster is
  disposable.** By the time `make verify` finishes, the `faults`
  namespace has scaled-up CPU/memory hogs running and one worker node
  is `NotReady` with its kubelet stopped. This is the point (it's what
  proves the alerts fire), but don't expect to keep using this cluster
  for anything else afterwards — run `make down`.
- **Dynamic fault sizing assumes kind-on-one-host semantics.** kind's
  nodes are containers sharing your machine's kernel, so node-exporter's
  per-node CPU/memory series are actually host-wide, not
  per-container. A single fault pod capped at its own small limit can't
  move `node:cpu_utilization:percent` past its alert threshold by
  itself, so `verify.sh` computes how many hog replicas are needed from
  the *live* host (core count, total memory) and scales to that number
  — which is why `make verify` takes on the order of 10-15 minutes and
  why the replica count you'll see in the logs varies by machine. This
  only holds because kind nodes share one kernel; it would not apply to
  real, separate nodes. The replica count is capped against runaway
  scaling, so on a very large host the node-level alerts may not reach
  80% — `verify.sh` will say so with a `WARN: ... capped at N replicas`
  line instead of failing silently.
