# Tech with Ugur — Labs

Hands-on, runnable labs in **cybersecurity**, **AI**, and **IoT**.
Each lab is self-contained under `labs/`, pairs with a post on the
[blog](https://techwithugur.dev/), and runs
end-to-end on a laptop from a fresh clone — the README of each lab is
the only instruction set you need.

## Labs

<!-- LAB-INDEX:BEGIN -->
| Lab | Tags | Blog post | Summary |
|-----|--------|-----------|---------|
| [lab-python-bytecode-blindspot](labs/lab-python-bytecode-blindspot/) | cybersecurity | [post](https://techwithugur.dev/posts/python-bytecode-blindspot/) | This lab ships a "friendly" package whose compiled bytecode leaks an environment secret on import, a source scanner that misses it, and a bytecode scanner that catches it. |
| [lab-supply-chain-egress-sandbox](labs/lab-supply-chain-egress-sandbox/) | cybersecurity | [post](https://techwithugur.dev/posts/supply-chain-egress-sandbox/) | This lab shows a benign-looking Python package steal seeded fake credentials at install time, then contains the same install inside a disposable container behind an egress-logging, default-deny proxy that blocks and attributes the leak. |
| [lab-css-webmail-exfil](labs/lab-css-webmail-exfil/) | cybersecurity | [post](https://techwithugur.dev/posts/css-webmail-exfil/) | This lab steals a seeded fake CSRF token from a webmail page one character at a time using only CSS attribute selectors and background-image requests, then blocks the identical attack with CSS sanitization, a Content-Security-Policy, and a sandboxed iframe. |
| [lab-local-deep-research](labs/lab-local-deep-research/) | ai | [post](https://techwithugur.dev/posts/local-deep-research/) | A TypeScript CLI that runs "deep research" entirely against a local model: `search` writes a cited markdown report and `analyze` answers questions grounded in everything you have researched, all driven by qwen3:4b in Ollama. |
| [lab-flux-helm-gitops](labs/lab-flux-helm-gitops/) | devops, cybersecurity | [post](https://techwithugur.dev/posts/flux-helm-gitops/) | This lab builds a complete, disposable GitOps loop on your own machine — Flux reconciling Helm releases from a local git server — and then deliberately breaks it five different ways, so you can watch the actual recovery mechanics instead of taking them on faith. |
| [lab-k8s-appsec-exploit](labs/lab-k8s-appsec-exploit/) | cybersecurity | [post](https://techwithugur.dev/posts/k8s-appsec-exploit/) | This lab hands you one URL to a deliberately vulnerable Node.js app on a disposable Kubernetes cluster, scans it with nuclei, then turns each finding into real impact — a stolen SSN through SQL injection, a shell through command injection, a leaked hardcoded API key, and a pod crashed by a single HTTP request. |
| [lab-k8s-appsec-scanning](labs/lab-k8s-appsec-scanning/) | cybersecurity | [post](https://techwithugur.dev/posts/k8s-appsec-scanning/) | This lab takes the same deliberately vulnerable app as its companion exploit lab and catches every one of its flaws before any of it runs — layered open-source scanners (Gitleaks, Semgrep, Trivy) across the code, build, and deploy stages, plus a Kyverno admission gate that refuses the vulnerable image and admits a hardened variant. |
| [lab-app-egress-audit](labs/lab-app-egress-audit/) | cybersecurity | [post](https://techwithugur.dev/posts/app-egress-audit/) | This lab builds an egress-inspection gateway from mitmproxy in transparent mode plus a DNS-logging dnsmasq resolver, forces a "freshly downloaded app" through it without configuring the app, then reads back exactly what the app leaked and where the visibility ends. |
| [lab-app-egress-ebpf](labs/lab-app-egress-ebpf/) | cybersecurity | [post](https://techwithugur.dev/posts/app-egress-ebpf/) | This lab catches a "freshly downloaded app" beaconing home from a dropped helper binary by instrumenting the Linux kernel with eBPF (Aqua Tracee), attributing every DNS answer and TCP connect to the exact process and its full parent lineage — with no proxy, no injected CA, and no cooperation from the app. |
| [lab-kube-prometheus-recording-rules](labs/lab-kube-prometheus-recording-rules/) | observability | [post](https://techwithugur.dev/posts/kube-prometheus-recording-rules/) | This lab deploys kube-prometheus-stack on kind and builds the customization layer real teams need on top: recording rules with human-readable node names, twin dashboards that prove why recording rules matter, and Grafana-managed alerts delivered to your own webhook server — no Alertmanager in the picture. |
| [lab-kube-prometheus-thanos-ha](labs/lab-kube-prometheus-thanos-ha/) | observability | [post](https://techwithugur.dev/posts/kube-prometheus-thanos-ha/) | This lab builds both scaling failure modes on purpose — two Prometheus shards, two replicas each — puts Thanos Query in front of them, and proves the fix with an automated verifier that compares answers against an unscaled control install, shows duplicates collapsed and shards partial, and kills pods mid-run to show the answers stay complete. |
| [lab-gcp-postgres-disaster-recovery](labs/lab-gcp-postgres-disaster-recovery/) | cloud, devops | [post](https://techwithugur.dev/posts/gcp-postgres-disaster-recovery/) | This lab provisions a real Cloud SQL for PostgreSQL instance with Terraform, ships a migration that silently corrupts committed data, then lets an automated runner detect the damage with an invariant check, restore from a pre-migration backup, and prove with table checksums that the restored data is identical to the baseline — with no human in the loop. |
| [lab-gcp-shared-vpc-foundation](labs/lab-gcp-shared-vpc-foundation/) | cloud, cybersecurity | [post](https://techwithugur.dev/posts/gcp-shared-vpc-foundation/) | This lab builds a miniature Shared-VPC landing zone — one host project owning the network, two service projects renting one subnet each, host-owned ingress through a global load balancer with Cloud Armor and egress through a Secure Web Proxy — and then tries to break it with five scripted proofs that impersonate each project's service account. |
| [lab-vibe-coded-llm-security](labs/lab-vibe-coded-llm-security/) | cybersecurity, ai | [post](https://techwithugur.dev/posts/vibe-coded-llm-security/) | This lab wires a local LLM into the two most dangerous sinks a program has — the network and the shell — then shows a poisoned document exfiltrating a secret and a "process my data" request turning into a reverse shell, and ships a hardened build of the same app where both attacks fail. |
| [lab-mcp-instruction-splitting](labs/lab-mcp-instruction-splitting/) | cybersecurity, ai | [post](https://techwithugur.dev/posts/mcp-instruction-splitting/) | This lab builds a malicious MCP server that hides an exfiltration instruction split across three innocuous-looking tool descriptions — clean to any per-description scan — lets a local tool-calling agent reassemble it and read a fake SSH key out to an attacker, then shuts it down with a client-side guardrail that inspects the whole tool list and default-denies the data-transmitting tool. |
| [lab-telegram-garden-agent](labs/lab-telegram-garden-agent/) | ai, iot, cybersecurity | [post](https://techwithugur.dev/posts/telegram-garden-agent/) | This lab talks to a mock indoor garden of four plants from anywhere through your own private Telegram bot — a LangGraph agent backed by the Anthropic API reading sensors and watering plants over four typed tools, in a container that publishes no ports and only ever dials out to Telegram and Anthropic. |
<!-- LAB-INDEX:END -->

## Conventions
- One folder per lab: `labs/lab-<topic>/`
- A single documented entrypoint (usually `docker compose up`)
- Pinned versions; a `test/` folder with the smoke test used to
  verify the lab
- Have a question, or found a problem? Open an issue using one of the
  templates — they ask for the lab folder name so it lands in context.

## License
[MIT](LICENSE)
