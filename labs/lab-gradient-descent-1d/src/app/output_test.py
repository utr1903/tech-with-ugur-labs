"""Behavioral checks for the recorded output tables."""

from __future__ import annotations

import csv
import importlib
from pathlib import Path

import pytest

from app.experiment import gradient_descent
from app.logging_setup import get_logger


def test_write_tables_preserves_all_states_in_both_formats(tmp_path: Path) -> None:
    """A missing row, reordered state, or rounded value must fail."""
    output = importlib.import_module("app.output")
    rows = tuple(
        row
        for run, start in (("left", -2.6), ("middle", 0.5), ("right", 2.6))
        for row in gradient_descent(start, 0.04, 100, run=run, log=get_logger())
    )
    directory = tmp_path / "absent" / "output"

    output.write_tables(rows, directory, log=get_logger())

    with (directory / "iterations.csv").open(newline="", encoding="utf-8") as stream:
        csv_records = list(csv.reader(stream))
    markdown_lines = (
        (directory / "iterations.md").read_text(encoding="utf-8").splitlines()
    )
    markdown_records = [
        [cell.strip() for cell in line.strip("|").split("|")]
        for line in markdown_lines
        if line.startswith("|")
    ]

    assert csv_records[0] == ["run", "iteration", "x", "cost", "slope"]
    assert markdown_records[0] == csv_records[0]
    assert len(csv_records) == 304
    assert len(markdown_records) == 305  # Header, separator, 303 data rows.
    assert markdown_records[1] == ["---"] * 5
    assert markdown_records[2:] == csv_records[1:]
    assert [record[0] for record in csv_records[1:]] == [
        run for run in ("left", "middle", "right") for _ in range(101)
    ]
    for run_index in range(3):
        run_records = csv_records[1 + 101 * run_index : 1 + 101 * (run_index + 1)]
        assert [int(record[1]) for record in run_records] == list(range(101))
    for record, original in zip(csv_records[1:], rows, strict=True):
        assert float(record[2]) == original.x
        assert float(record[3]) == original.cost
        assert float(record[4]) == original.slope
    for current, following in zip(csv_records[1:], csv_records[2:], strict=False):
        if current[0] == following[0]:
            assert float(following[2]) == pytest.approx(
                float(current[2]) - 0.04 * float(current[4]), abs=1e-15
            )
