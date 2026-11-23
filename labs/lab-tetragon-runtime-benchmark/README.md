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
make up         # kind cluster, Tetragon 1.8.0, victim/attacker/webapp pods
make bench      # benchmark scenarios, RUNS=3 per scenario
make behaviour  # behaviour demos
make down       # delete the cluster
```

## What "happened" means for the kernel-module and BPF scenarios

Scenario 08 does not load a real kernel module. It hands `finit_module()` a
64-byte file of random bytes, which the kernel can never load. The question it
answers is whether the request **reached the kernel's module loader**:

- Without enforcement the loader parses the file and rejects it with
  `ENOEXEC` ("Exec format error"). The scenario counts that as "happened":
  the same call with a real module would load it (unless the kernel
  enforces module signatures).
- With the `kmod` policy enforcing, Tetragon's Override returns `EPERM`
  before the loader runs. Only `EPERM` counts as "blocked".

Scenario 10 does load a real eBPF program: a two-instruction socket filter
that returns 0. Without enforcement `bpf(BPF_PROG_LOAD)` returns a file
descriptor; with the `bpf` policy enforcing it returns `EPERM`.

Both run in `victim-priv`, a privileged pod. In an unprivileged pod both calls
fail with `EPERM` anyway, which would make "blocked" meaningless.
