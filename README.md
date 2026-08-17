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
<!-- LAB-INDEX:END -->

## Conventions
- One folder per lab: `labs/lab-<topic>/`
- A single documented entrypoint (usually `docker compose up`)
- Pinned versions; a `test/` folder with the smoke test used to
  verify the lab
- Found a problem? Open an issue — mention the lab folder name.

## License
[MIT](LICENSE)