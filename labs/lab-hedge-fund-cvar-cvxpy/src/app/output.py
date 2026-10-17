"""The sole writer for reader-facing output."""

from __future__ import annotations

import sys


def write_line(text: str = "") -> None:
    """Write one human-readable line to standard output."""
    sys.stdout.write(f"{text}\n")
