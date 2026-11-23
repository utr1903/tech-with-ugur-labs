# Tetragon runtime security benchmark on kind

Run a set of attack scenarios against a pod on a local kind cluster, with and
without Tetragon tracing policies, and see which ones are detected and which
are blocked.

## Prerequisites

| Tool | Version |
|------|---------|
| Docker | running daemon |
| kind | v0.32.0 |
| kubectl | 1.36 |
| helm | 4.x |
| uv | 0.9+ (fetches Python 3.12) |

## Quickstart

```bash
make up         # kind cluster + Tetragon
make bench      # benchmark scenarios, RUNS=3 per scenario
make behaviour  # behaviour demos
make down       # delete the cluster
```

More detail follows as the lab grows.
