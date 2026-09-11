"""Immutable labelled table cells and rows."""

from __future__ import annotations

from dataclasses import dataclass

type Cell = str | int | float


@dataclass(frozen=True)
class Table:
    name: str
    title: str
    columns: tuple[str, ...]
    rows: tuple[tuple[Cell, ...], ...]
