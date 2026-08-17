"""Install the demo package and record whether pip + import succeeded.

Exits nonzero only when the INSTALL fails. A blocked exfiltration attempt is
expected to leave the install succeeding — that is the whole point — so it
must not fail this container.
"""

import importlib
import json
import os
import subprocess
import sys

LABEL = os.environ.get("RUN_LABEL", "run")
URL = os.environ.get("PKG_URL", "http://mirror:8000/friendly-1.0.0.tar.gz")
EVIDENCE = "/evidence"

print(f"[{LABEL}] pip install {URL}", flush=True)
pip_rc = subprocess.run(
    [
        sys.executable, "-m", "pip", "install",
        "--no-index", "--no-build-isolation", URL,
    ]
).returncode
print(f"[{LABEL}] pip exit={pip_rc}", flush=True)

import_ok = False
greeting = ""
try:
    friendly = importlib.import_module("friendly")
    greeting = friendly.greet("reader")
    import_ok = True
    print(f"[{LABEL}] import friendly OK -> {greeting}", flush=True)
except Exception as exc:
    print(f"[{LABEL}] import friendly FAILED: {exc}", flush=True)

os.makedirs(EVIDENCE, exist_ok=True)
with open(os.path.join(EVIDENCE, f"{LABEL}_install.json"), "w") as fh:
    json.dump(
        {"label": LABEL, "pip_rc": pip_rc, "import_ok": import_ok, "greeting": greeting},
        fh,
    )

sys.exit(0 if (pip_rc == 0 and import_ok) else 1)
