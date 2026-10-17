"""Serializing one table to CSV text, with every float written raw.

`repr` is what a float is written with — the shortest string that reads
back as the same double — and never a rounded format. The console rounds
to two decimals because it is for reading; these files are for
recomputing, and a reader checking the lab's arithmetic in a spreadsheet
needs the bits the solver actually produced.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence


def cell(value: object) -> str:
    """Write one cell: floats raw, `None` as an empty field."""
    if value is None:
        return ""
    if isinstance(value, float):
        return repr(value)
    return str(value)


def table(columns: Sequence[str], rows: Sequence[Sequence[object]]) -> str:
    """Serialize one table to CSV text, one newline-terminated row each."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    writer.writerows([cell(value) for value in line] for line in rows)
    return buffer.getvalue()
