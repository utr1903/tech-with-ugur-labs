"""Deliberate runner failures."""

from __future__ import annotations


class LabError(Exception):
    """Runner domain failure."""


class SourceLimitError(LabError):
    """Source exceeds the fixed UTF-8 budget."""
