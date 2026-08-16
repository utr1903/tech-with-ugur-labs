# The Python Bytecode Blind Spot

Most Python source scanners read a package's `.py` files. But Python runs
*bytecode*, and a shipped `.pyc` can diverge from its source so the code that
executes is not the code you reviewed. This lab ships a "friendly" package
whose compiled bytecode leaks an environment secret on import, a source
scanner that misses it, and a bytecode scanner that catches it.

Companion post: [The Python Bytecode Blind Spot: when the source you scan
isn't the code that runs](https://utr1903.github.io/tech-with-ugur-blog/posts/python-bytecode-blindspot/).

## Prerequisites
- Docker with Compose v2 (`docker compose version`)

## Run it
```bash
docker compose up --build
docker compose run --rm lab pytest -q
docker compose down
```

## What you should see
`docker compose up --build` exits 0 and prints two verdicts: the source-only
AST scanner reports `friendly` CLEAN, while the bytecode-aware scanner reports
a source/bytecode MISMATCH and names the hidden behavior (an `open` writing to
`/tmp/leak.txt`). `pytest -q` passes, including a test proving the bytecode
scanner reports clean once the `.pyc` is regenerated from the real source.

## How it works
`build_pyc.py` compiles `payload_source.py` (which reads `FANCY_SECRET` and
writes it to `/tmp/leak.txt` at import) into `friendly/__pycache__/`, forging a
timestamp header that matches the benign `friendly/__init__.py`. Python trusts
that header and loads the payload bytecode on import. `scan_source.py` AST-scans
the `.py` and sees nothing; `scan_bytecode.py` recompiles the source, diffs it
against the shipped `.pyc`, and disassembles the difference.

## Clean up
```bash
docker compose down --rmi local
```
