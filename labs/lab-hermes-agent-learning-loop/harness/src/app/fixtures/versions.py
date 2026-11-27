"""Numeric dotted-version comparison."""

from __future__ import annotations

type Version = tuple[int, ...]


def parse_version(text: str) -> Version:
    """Turns "1.10.0" into (1, 10, 0) so versions compare numerically."""
    return tuple(int(part) for part in text.split("."))


def compare_versions(left: str, right: str) -> int:
    """Returns -1, 0 or 1; missing trailing parts count as zero."""
    a, b = parse_version(left), parse_version(right)
    width = max(len(a), len(b))
    a, b = a + (0,) * (width - len(a)), b + (0,) * (width - len(b))
    return (a > b) - (a < b)
