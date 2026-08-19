# Tech with Ugur — Labs

Hands-on, runnable labs in **cybersecurity**, **AI**, and **IoT**.
Each lab is self-contained under `labs/`, pairs with a post on the
[blog](https://utr1903.github.io/tech-with-ugur-blog/), and runs
end-to-end on a laptop from a fresh clone — the README of each lab is
the only instruction set you need.

## Labs

<!-- LAB-INDEX:BEGIN -->
| Lab | Domain | Blog post | Summary |
|-----|--------|-----------|---------|
| [lab-python-bytecode-blindspot](labs/lab-python-bytecode-blindspot/) | cybersecurity | [post](https://utr1903.github.io/tech-with-ugur-blog/posts/python-bytecode-blindspot/) | This lab ships a "friendly" package whose compiled bytecode leaks an environment secret on import, a source scanner that misses it, and a bytecode scanner that catches it. |
| [lab-supply-chain-egress-sandbox](labs/lab-supply-chain-egress-sandbox/) | cybersecurity | [post](https://utr1903.github.io/tech-with-ugur-blog/posts/supply-chain-egress-sandbox/) | This lab shows a benign-looking Python package steal seeded fake credentials at install time, then contains the same install inside a disposable container behind an egress-logging, default-deny proxy that blocks and attributes the leak. |
| [lab-css-webmail-exfil](labs/lab-css-webmail-exfil/) | cybersecurity | [post](https://utr1903.github.io/tech-with-ugur-blog/posts/css-webmail-exfil/) | This lab steals a seeded fake CSRF token from a webmail page one character at a time using only CSS attribute selectors and background-image requests, then blocks the identical attack with CSS sanitization, a Content-Security-Policy, and a sandboxed iframe. |
| [lab-local-deep-research](labs/lab-local-deep-research/) | ai | [post](https://utr1903.github.io/tech-with-ugur-blog/posts/local-deep-research/) | A TypeScript CLI that runs "deep research" entirely against a local model: `search` writes a cited markdown report and `analyze` answers questions grounded in everything you have researched, all driven by qwen3:4b in Ollama. |
| [lab-flux-helm-gitops](labs/lab-flux-helm-gitops/) | cybersecurity | [post](https://utr1903.github.io/tech-with-ugur-blog/posts/flux-helm-gitops/) | This lab builds a complete, disposable GitOps loop on your own machine — Flux reconciling Helm releases from a local git server — and then deliberately breaks it five different ways, so you can watch the actual recovery mechanics instead of taking them on faith. |
| [lab-k8s-appsec-exploit](labs/lab-k8s-appsec-exploit/) | cybersecurity | [post](https://utr1903.github.io/tech-with-ugur-blog/posts/k8s-appsec-exploit/) | This lab hands you one URL to a deliberately vulnerable Node.js app on a disposable Kubernetes cluster, scans it with nuclei, then turns each finding into real impact — a stolen SSN through SQL injection, a shell through command injection, a leaked hardcoded API key, and a pod crashed by a single HTTP request. |
<!-- LAB-INDEX:END -->

## Conventions
- One folder per lab: `labs/lab-<topic>/`
- A single documented entrypoint (usually `docker compose up`)
- Pinned versions; a `test/` folder with the smoke test used to
  verify the lab
- Found a problem? Open an issue — mention the lab folder name.

## License
[MIT](LICENSE)