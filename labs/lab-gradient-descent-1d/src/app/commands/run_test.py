"""Verify the reader workflow against independent numerical expectations."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.commands.run import run
from app.logging_setup import get_logger


def _slope(x: float) -> float:
    # Expanded derivative, independent of the production factored expression.
    return 0.375 * x**5 - 2 * x**3 + 2 * x + 0.1


def _stationary_points() -> list[tuple[float, str]]:
    roots: list[tuple[float, str]] = []
    for index in range(6000):
        left = -3 + index / 1000
        right = left + 0.001
        if _slope(left) * _slope(right) >= 0:
            continue
        kind = "minimum" if _slope(left) < 0 else "maximum"
        for _ in range(40):
            middle = (left + right) / 2
            if _slope(left) * _slope(middle) <= 0:
                right = middle
            else:
                left = middle
        roots.append(((left + right) / 2, kind))
    return roots


def test_run_reaches_three_distinct_minima_and_writes_all_outputs(
    tmp_path: Path,
) -> None:
    # Wrong start/step count, missing output, or all runs in one basin fails.
    stationary = _stationary_points()
    assert [kind for _, kind in stationary] == [
        "minimum",
        "maximum",
        "minimum",
        "maximum",
        "minimum",
    ]
    rows = run(output_dir=tmp_path, log=get_logger())
    assert len(rows) == 303
    finals = sorted((row for row in rows if row.iteration == 100), key=lambda r: r.x)
    minima = [x for x, kind in stationary if kind == "minimum"]
    assert [row.x for row in finals] == pytest.approx(minima, abs=0.0003)
    assert min(finals, key=lambda row: row.cost) == finals[0]
    for name in ("gradient-descent.png", "iterations.csv", "iterations.md"):
        assert (tmp_path / name).stat().st_size > 0


def test_cli_writes_outputs_and_logs_lowest_final_cost(tmp_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "app"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    events = [json.loads(line) for line in result.stdout.splitlines()]
    best = [event for event in events if "lowest_final_cost" in event]
    assert len(best) == 1
    assert best[0]["lowest_final_cost"] == pytest.approx(-0.200613678139839, abs=1e-8)
    assert (tmp_path / "output" / "gradient-descent.png").is_file()
