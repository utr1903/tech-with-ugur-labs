"""Check the rendered figure preserves every recorded optimizer state."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import SupportsFloat

import pytest
from matplotlib.figure import Figure
from matplotlib.lines import Line2D

from app.experiment import gradient_descent
from app.logging_setup import get_logger
from app.plotting import write_plot


def _values(line: Line2D, *, x: bool) -> list[float]:
    values = line.get_xdata() if x else line.get_ydata()
    assert isinstance(values, Iterable)
    result = []
    for value in values:
        assert isinstance(value, SupportsFloat)
        result.append(float(value))
    return result


def test_plot_has_two_panels_and_every_iteration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Dropping an iterate or a whole panel must fail, even for a valid PNG.
    rows = tuple(
        row
        for name, start in (("left", -2.6), ("center", 0.5), ("right", 2.6))
        for row in gradient_descent(start, 0.04, 100, run=name, log=get_logger())
    )
    figures: list[Figure] = []
    original = Figure.savefig

    def capture(self: Figure, fname: str | Path, *, dpi: float) -> None:
        figures.append(self)
        original(self, fname, dpi=dpi)

    monkeypatch.setattr(Figure, "savefig", capture)
    destination = tmp_path / "nested" / "plot.png"
    write_plot(rows, destination, log=get_logger())
    assert destination.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    assert len(figures[0].axes) == 2
    landscape, history = figures[0].axes
    assert len(_values(landscape.lines[0], x=True)) >= 500
    assert len(landscape.lines) == 4
    assert len(history.lines) == 3
    for index, name in enumerate(("left", "center", "right")):
        states = [row for row in rows if row.run == name]
        assert _values(landscape.lines[index + 1], x=True) == [row.x for row in states]
        assert _values(landscape.lines[index + 1], x=False) == [
            row.cost for row in states
        ]
        assert _values(history.lines[index], x=True) == list(range(101))
        assert _values(history.lines[index], x=False) == [row.cost for row in states]
