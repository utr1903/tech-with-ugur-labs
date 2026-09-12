"""End-to-end tests for command-line exits and default result artifacts."""

from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path

import pytest

from app import __main__ as main_module
from app.errors import (
    ArtifactError,
    LabError,
    NoIncumbentError,
    ScenarioError,
    VerificationError,
)


def _run_app(*arguments: str, lab_root: Path) -> subprocess.CompletedProcess[str]:
    """Run the installed command module in a separate process from the lab root."""
    return subprocess.run(
        [sys.executable, "-m", "app", *arguments],
        cwd=lab_root,
        text=True,
        capture_output=True,
        check=False,
    )


def test_default_subprocess_writes_a_verified_three_year_plan(tmp_path: Path) -> None:
    """The documented scenario solves with an incumbent inside the 1% target."""
    lab_root = Path(__file__).resolve().parents[2]
    output_dir = tmp_path / "output"

    completed = _run_app(
        "--scenario",
        str(lab_root / "scenario.yaml"),
        "--output",
        str(output_dir),
        lab_root=lab_root,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    with (output_dir / "annual_plan.csv").open(newline="", encoding="utf-8") as file:
        annual_rows = list(csv.DictReader(file))
    solution = json.loads((output_dir / "solution.json").read_text(encoding="utf-8"))
    assert len(annual_rows) == 3
    assert [int(row["year"]) for row in annual_rows] == [1, 2, 3]
    assert solution["decisions"] is not None
    assert solution["solver"]["status"] in {"optimal", "gaplimit"}
    assert solution["solver"]["relative_gap"] <= 0.01
    assert solution["verification"]["maximum_violation"] <= 1.0
    assert "Verified annual manufacturing plan" in completed.stdout


def test_invalid_scenario_subprocess_returns_exit_two(tmp_path: Path) -> None:
    """Malformed YAML reaches the documented scenario-error process exit."""
    lab_root = Path(__file__).resolve().parents[2]
    scenario_path = tmp_path / "bad.yaml"
    output_dir = tmp_path / "output"
    scenario_path.write_text("product: [\n", encoding="utf-8")

    completed = _run_app(
        "--scenario",
        str(scenario_path),
        "--output",
        str(output_dir),
        lab_root=lab_root,
    )

    assert completed.returncode == 2
    assert not output_dir.exists()


@pytest.mark.parametrize(
    ("error_type", "expected_exit"),
    [
        (ScenarioError, 2),
        (NoIncumbentError, 3),
        (VerificationError, 4),
        (ArtifactError, 1),
    ],
)
def test_main_maps_each_domain_failure_to_its_documented_exit(
    monkeypatch: pytest.MonkeyPatch,
    error_type: type[LabError],
    expected_exit: int,
) -> None:
    """Command failures remain distinguishable to scripts through exit status."""

    def reject_run(*_args: object, **_kwargs: object) -> None:
        """Raise one controlled domain failure from the command boundary."""
        raise error_type("controlled failure")

    monkeypatch.setattr(main_module, "run", reject_run)
    monkeypatch.setattr(sys, "argv", ["app"])

    assert main_module.main() == expected_exit
