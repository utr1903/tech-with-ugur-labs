"""The one reader-facing writer; everything machine-readable goes via logs."""

from __future__ import annotations

import sys


def write_line(text: str = "") -> None:
    """Writes one line of reader-facing text to stdout."""
    sys.stdout.write(f"{text}\n")
