"""How every number and every column on the reader surface is written down.

Two decisions live here and nowhere else.

**Units.** Nothing on the console is printed as a bare fraction. A weight,
an exposure or a tail loss is a percentage of NAV; a monthly return, a
cost and a shadow price are basis points. Both are named in the heading of
the table that uses them, because "0.0082" is a number a reader has to
decode and "82 bp" is one they can argue with.

**Precision.** Two decimals on the console, raw floats in `output/`. The
console is for reading and the CSVs are for recomputing, so rounding here
costs nothing that is not recoverable from the artifacts beside it.
"""

from __future__ import annotations

from collections.abc import Sequence

# One basis point as a fraction. A monthly return target of 0.0080 then
# reads as 80.00 bp, and a tail loss of 0.0200 of NAV as 200.00 bp.
BASIS_POINT = 1e-4

# Display precision on the console. The artifacts keep the raw floats.
DECIMALS = 2

# What a column holds where the run produced no number at all — an
# infeasible frontier point, a solver that reported no iteration count, a
# shadow price whose re-solve could not be completed. Spelled out rather
# than left blank, so a gap in a table is visibly a gap.
ABSENT = "n/a"


def nav_percent(value: float) -> str:
    """Write a fraction of NAV as a percentage: 0.0650 becomes '6.50'."""
    return f"{value * 100.0:.{DECIMALS}f}"


def basis_points(value: float) -> str:
    """Write a monthly return or a tail loss in basis points."""
    return f"{value / BASIS_POINT:.{DECIMALS}f}"


def optional_nav_percent(value: float | None) -> str:
    """Write a fraction of NAV, or `ABSENT` where there is none."""
    return ABSENT if value is None else nav_percent(value)


def optional_count(value: int | None) -> str:
    """Write a count, or `ABSENT` where the solver reported none."""
    return ABSENT if value is None else str(value)


def seconds(value: float) -> str:
    """Write a wall-clock measurement in seconds.

    Three decimals rather than two: a small solve on a small sample
    finishes in a few milliseconds, and two decimals would print every
    rung of the algorithm ladder as 0.00.
    """
    return f"{value:.3f}"


def yes_no(flag: bool) -> str:
    """Write a boolean as a word rather than as `True`."""
    return "yes" if flag else "no"


def row(cells: Sequence[str], widths: Sequence[int]) -> str:
    """Lay out one table row: first column left, every other right.

    A label reads best against the left margin and a column of numbers
    reads best against the right, which is the whole rule. Two leading
    spaces indent every table under its heading.

    Args:
        cells: The already-formatted contents, one per column.
        widths: The column widths, same length as `cells`.

    Returns:
        One line, with no trailing whitespace.
    """
    padded = [
        cell.ljust(width) if index == 0 else cell.rjust(width)
        for index, (cell, width) in enumerate(zip(cells, widths, strict=True))
    ]
    return f"  {'  '.join(padded)}".rstrip()


def rule(widths: Sequence[int]) -> str:
    """Write the dashed line that separates a table's heading from its body."""
    return row(["-" * width for width in widths], widths)
