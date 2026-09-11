"""Artifact and console behavior tests for verified manufacturing results."""

from __future__ import annotations

import csv
import json
from dataclasses import fields, replace
from pathlib import Path
from types import TracebackType
from typing import Self

import numpy as np
import pytest

from app.errors import ArtifactError
from app.logging_setup import Logger
from app.model import DecisionValues, SolveResult
from app.results import write_results
from app.scenario import Scenario
from app.verification import AnnualRow, verify_solution


class _WriteFailingTemporaryFile:
    """A real sibling file whose write leaves partial bytes then raises."""

    def __init__(self, path: Path) -> None:
        """Create the temporary path that production cleanup must own."""
        self.path = path
        self.name = str(path)
        self.path.touch()

    def __enter__(self) -> Self:
        """Expose the path and failing writer through the file context API."""
        return self

    def __exit__(
        self,
        _exc_type: type[BaseException] | None,
        _exc: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        """Leave cleanup responsibility with the result writer."""

    def write(self, text: str) -> int:
        """Persist partial bytes, then reproduce a filesystem write failure."""
        self.path.write_text(text[:1], encoding="utf-8")
        raise OSError("forced temporary-file write failure")


def _failing_named_temporary_file(**options: object) -> _WriteFailingTemporaryFile:
    """Create a deterministic real sibling matching NamedTemporaryFile output."""
    directory = options.get("dir")
    prefix = options.get("prefix")
    suffix = options.get("suffix")
    if not isinstance(directory, Path):
        raise TypeError("test expected a pathlib output directory")
    if not isinstance(prefix, str) or not isinstance(suffix, str):
        raise TypeError("test expected string temporary-file affixes")
    return _WriteFailingTemporaryFile(directory / f"{prefix}forced{suffix}")


def _worked_result() -> SolveResult:
    """Return a complete solver result matching the hand-calculated example."""
    return SolveResult(
        decisions=DecisionValues(
            workers=np.array([4.0, 4.0, 4.0]),
            researchers=np.array([2.0, 1.0, 0.0]),
            expansion_start=np.array([0.0, 0.0, 0.0]),
            units_produced=np.array([4000.0, 4000.0, 4000.0]),
            unit_cost=np.array([50.0, 43.0, 39.0]),
        ),
        status="optimal",
        objective_usd=281999.5,
        objective_bound_usd=282000.0,
        relative_gap=0.0000018,
        solve_seconds=0.125,
    )


def test_writes_complete_csv_json_and_readable_console(
    tmp_path: Path, scenario: Scenario, log: Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    """One successful write preserves raw values in two machine-readable files."""
    result = _worked_result()
    assert result.decisions is not None
    verification = verify_solution(scenario, result.decisions, log=log)
    output_dir = tmp_path / "new-output"

    write_results(output_dir, scenario, result, verification, log=log)

    assert sorted(path.name for path in output_dir.iterdir()) == [
        "annual_plan.csv",
        "solution.json",
    ]
    with (output_dir / "annual_plan.csv").open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        rows = list(reader)
    assert reader.fieldnames == [field.name for field in fields(AnnualRow)]
    assert len(rows) == 3
    assert [int(row["year"]) for row in rows] == [1, 2, 3]
    assert [float(row["annual_net_cash_usd"]) for row in rows] == [
        60000,
        98000,
        124000,
    ]

    raw_json = (output_dir / "solution.json").read_text(encoding="utf-8")
    payload = json.loads(
        raw_json,
        parse_constant=lambda value: (_ for _ in ()).throw(
            AssertionError(f"non-finite JSON token: {value}")
        ),
    )
    assert payload["input_sha256"] == scenario.input_sha256
    assert payload["solver_settings"] == {
        "time_limit_seconds": 120.0,
        "relative_gap": 0.01,
    }
    assert payload["decisions"] == {
        "workers": [4.0, 4.0, 4.0],
        "researchers": [2.0, 1.0, 0.0],
        "expansion_start": [0.0, 0.0, 0.0],
        "units_produced": [4000.0, 4000.0, 4000.0],
        "unit_cost": [50.0, 43.0, 39.0],
    }
    assert payload["solver"] == {
        "status": "optimal",
        "objective_usd": 281999.5,
        "objective_bound_usd": 282000.0,
        "relative_gap": 0.0000018,
        "solve_seconds": 0.125,
    }
    assert payload["verification"] == {
        "absolute_tolerance": 1e-5,
        "relative_tolerance": 1e-7,
        "maximum_violation": 0.0,
        "total_net_cash_usd": 282000.0,
        "objective_difference_usd": 0.5,
    }

    console = capsys.readouterr().out
    assert "Units: people" in console
    assert "Yr" in console
    assert "New save" in console
    assert "1" in console and "3" in console
    assert "Total net cash: $282,000.00" in console
    assert "Solver status: optimal" in console
    assert "Relative gap: 0.000180%" in console
    assert "Solver objective: $281,999.50" in console
    assert "Recomputed cash differs by: $0.50" in console


def test_serialization_failure_preserves_existing_artifacts(
    tmp_path: Path, scenario: Scenario, log: Logger
) -> None:
    """Non-finite JSON data fails before either existing target is touched."""
    output_dir = tmp_path / "existing-output"
    output_dir.mkdir()
    csv_path = output_dir / "annual_plan.csv"
    json_path = output_dir / "solution.json"
    csv_path.write_bytes(b"old csv\n")
    json_path.write_bytes(b"old json\n")
    result = replace(_worked_result(), objective_bound_usd=float("nan"))
    assert result.decisions is not None
    verification = verify_solution(scenario, result.decisions, log=log)

    with pytest.raises(ArtifactError):
        write_results(output_dir, scenario, result, verification, log=log)

    assert csv_path.read_bytes() == b"old csv\n"
    assert json_path.read_bytes() == b"old json\n"
    assert sorted(path.name for path in output_dir.iterdir()) == [
        "annual_plan.csv",
        "solution.json",
    ]


def test_temporary_write_failure_removes_partial_file_and_preserves_artifacts(
    tmp_path: Path,
    scenario: Scenario,
    log: Logger,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A partial sibling is cleaned when its first write raises OSError."""
    output_dir = tmp_path / "existing-output"
    output_dir.mkdir()
    csv_path = output_dir / "annual_plan.csv"
    json_path = output_dir / "solution.json"
    csv_path.write_bytes(b"old csv\n")
    json_path.write_bytes(b"old json\n")
    result = _worked_result()
    assert result.decisions is not None
    verification = verify_solution(scenario, result.decisions, log=log)
    monkeypatch.setattr(
        "app.results.tempfile.NamedTemporaryFile", _failing_named_temporary_file
    )

    with pytest.raises(ArtifactError, match="Could not write results"):
        write_results(output_dir, scenario, result, verification, log=log)

    assert csv_path.read_bytes() == b"old csv\n"
    assert json_path.read_bytes() == b"old json\n"
    assert sorted(path.name for path in output_dir.iterdir()) == [
        "annual_plan.csv",
        "solution.json",
    ]


def test_console_shows_fractional_production_to_two_decimals(
    tmp_path: Path,
    scenario: Scenario,
    log: Logger,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Continuous production remains visible below whole-unit precision."""
    result = _worked_result()
    assert result.decisions is not None
    decisions = replace(
        result.decisions,
        units_produced=np.array([3999.4, 4000.0, 4000.0]),
    )
    result = replace(result, decisions=decisions)
    verification = verify_solution(scenario, decisions, log=log)

    write_results(tmp_path / "output", scenario, result, verification, log=log)

    assert "3,999.40" in capsys.readouterr().out
