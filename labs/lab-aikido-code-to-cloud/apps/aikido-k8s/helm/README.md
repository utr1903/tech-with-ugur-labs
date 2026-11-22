# aikido-k8s

Wrapper chart that pins and configures the upstream
[Aikido Kubernetes agent](https://github.com/AikidoSec/helm-charts) chart
(`kubernetes-agent` 2.16.1). It is not a planted flaw; it is meant to be clean.

## Manual install

```bash
helm repo add aikido https://aikidosec.github.io/helm-charts
cd apps/aikido-k8s/helm
helm dependency update
helm upgrade -i aikido . -n aikido --create-namespace \
  --set kubernetes-agent.config.apiToken=$TOKEN
```

The token comes from the Aikido API (`POST /clouds/kubernetes`, called by `make deploy`) and is never committed.

## Values set

| Value (under `kubernetes-agent`) | Setting | Why |
|---|---|---|
| `config.apiEndpoint` | `https://k8s.aikido-security.com` | Aikido endpoint from the install wizard. |
| `config.apiToken` | `""` | Placeholder, injected with `--set` at install time. |
| `sbomCollector.enabled` | `true` | Needed for image scanning; off upstream by default. Renders a DaemonSet. |
| `runtimeDetection.enabled` | `true` | Runtime Sensors; off upstream by default. Pulls in the Falco subchart (DaemonSet `aikido-kubernetes-agent-runtime-detection`, `modern_ebpf` driver, image `public.ecr.aws/aikido-cloud/falco`). Detect-only. Also needs the cluster's threat detection toggle in the Aikido UI. |

## Upstream defaults reviewed

Left unchanged: `agent.autoUpdate.enabled: true` (agent and SBOM collector self-update),
and resource requests/limits for both the agent and the SBOM collector are already set upstream.
`networkPolicy.enabled` (true) and `agent.githubArc.legacyRunnerAccess.enabled` (false) are also kept as is.

## Testing

```bash
./tests/check_chart.sh
```

Lints and renders the chart, then checks that the SBOM collector and the Falco DaemonSet render, and that Falco posts to `http://aikido-kubernetes-agent:8241/detection`. That URL depends on the release being named `aikido`.
