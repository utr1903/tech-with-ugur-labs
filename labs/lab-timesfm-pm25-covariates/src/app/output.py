"""Human-readable output.

The lab's deliverable is a scoreboard and a checks table that a person
reads. Everything else this app says goes to the JSON log; this module is
the only sanctioned exception, and it exists so that exception is one
function in one file rather than a print() habit.
"""

from __future__ import annotations

import sys


def write_line(text: str) -> None:
    """Writes one pre-rendered block to stdout, followed by a newline."""
    sys.stdout.write(f"{text}\n")
