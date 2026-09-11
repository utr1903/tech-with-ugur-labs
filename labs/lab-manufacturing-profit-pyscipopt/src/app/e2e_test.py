"""End-to-end acceptance tests for the installed command-line application."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

LAB_ROOT = Path(__file__).parents[2]
DEFAULT_SCENARIO = LAB_ROOT / "scenario.yaml"
CSV_ARTIFACTS = (
    "annual_cash.csv",
    "budget_utilization.csv",
    "investments.csv",
    "headcount.csv",
    "rd_and_knowledge.csv",
    "market_plan.csv",
    "factory_plan.csv",
    "shipments.csv",
)
PNG_ARTIFACTS = ("cash_composition.png", "investment_production.png")
ALL_ARTIFACTS = ("solution.json", *CSV_ARTIFACTS, *PNG_ARTIFACTS)
SOLVER_STOPPING_TOLERANCE_SECONDS = 1.0


def _run_cli(
    scenario: Path,
    output: Path,
    *extra_args: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "app",
            "--scenario",
            str(scenario),
            "--output",
            str(output),
            *extra_args,
        ],
        cwd=LAB_ROOT,
        text=True,
        capture_output=True,
        check=False,
        timeout=150,
    )


def _load_solution(output: Path) -> dict[str, Any]:
    payload: object = json.loads((output / "solution.json").read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


def _assert_complete_artifacts(output: Path) -> dict[str, Any]:
    assert {path.name for path in output.iterdir()} == set(ALL_ARTIFACTS)
    for name in CSV_ARTIFACTS:
        assert (output / name).stat().st_size > 0
    for name in PNG_ARTIFACTS:
        image = (output / name).read_bytes()
        assert image.startswith(b"\x89PNG\r\n\x1a\n")
        assert len(image) > 8
    payload = _load_solution(output)
    assert payload["metadata"]["has_incumbent"] is True
    assert payload["verification"]["ok"] is True
    assert payload["cumulative_cash_musd"] == pytest.approx(
        sum(payload["annual_cash_musd"]["net_cash"])
    )
    return payload


def _write_infeasible_scenario(destination: Path) -> None:
    original = DEFAULT_SCENARIO.read_text(encoding="utf-8")
    feasible = (
        "    us: {year_1: 0.5, year_2: 0.5, year_3: 0.5}\n"
        "    india: {year_1: 0.5, year_2: 0.5, year_3: 0.5}"
    )
    infeasible = (
        "    us: {year_1: 100, year_2: 100, year_3: 100}\n"
        "    india: {year_1: 0.5, year_2: 0.5, year_3: 0.5}"
    )
    assert original.count(feasible) == 1
    destination.write_text(original.replace(feasible, infeasible), encoding="utf-8")


def _seed_artifacts(output: Path) -> dict[str, bytes]:
    output.mkdir()
    seeded = {name: f"prior:{name}\n".encode() for name in ALL_ARTIFACTS}
    for name, contents in seeded.items():
        (output / name).write_bytes(contents)
    return seeded


def test_default_scenario_writes_verified_complete_report(tmp_path: Path) -> None:
    output = tmp_path / "output"
    result = _run_cli(DEFAULT_SCENARIO, output)

    assert result.returncode == 0, result.stdout + result.stderr
    payload = _assert_complete_artifacts(output)
    metadata = payload["metadata"]
    assert metadata["status"] in {"gaplimit", "optimal"}
    assert f"Solver status: {metadata['status']};" in result.stdout
    assert metadata["solve_seconds"] <= (
        payload["solver_settings"]["time_limit_seconds"]
        + SOLVER_STOPPING_TOLERANCE_SECONDS
    )
    gap = metadata["relative_gap"]
    assert isinstance(gap, int | float)
    assert 0 <= gap <= payload["solver_settings"]["relative_gap"]


def test_invalid_yaml_exits_with_scenario_error(tmp_path: Path) -> None:
    scenario = tmp_path / "invalid.yaml"
    scenario.write_text("solver: [\n", encoding="utf-8")
    output = tmp_path / "output"

    result = _run_cli(scenario, output)

    assert result.returncode == 2, result.stdout + result.stderr
    assert not output.exists()


@pytest.mark.parametrize(
    ("option", "value", "field"),
    [
        ("--time-limit", "nan", "time_limit_seconds"),
        ("--time-limit", "inf", "time_limit_seconds"),
        ("--time-limit", "-inf", "time_limit_seconds"),
        ("--gap", "nan", "relative_gap"),
        ("--gap", "inf", "relative_gap"),
        ("--gap", "-inf", "relative_gap"),
    ],
)
def test_nonfinite_cli_solver_override_exits_before_model_build(
    tmp_path: Path,
    option: str,
    value: str,
    field: str,
) -> None:
    output = tmp_path / "output"
    arguments = (f"{option}={value}",) if value.startswith("-") else (option, value)

    result = _run_cli(DEFAULT_SCENARIO, output, *arguments)

    assert result.returncode == 2, result.stdout + result.stderr
    assert f"scenario.solver.{field}" in result.stdout
    assert "Building model..." not in result.stdout
    assert "Solving model..." not in result.stdout
    assert not output.exists()


def test_valid_but_infeasible_scenario_reports_no_incumbent(tmp_path: Path) -> None:
    scenario = tmp_path / "infeasible.yaml"
    _write_infeasible_scenario(scenario)
    output = tmp_path / "output"

    result = _run_cli(scenario, output)

    assert result.returncode == 3, result.stdout + result.stderr
    assert "Solver status: infeasible; classification: no_incumbent" in result.stdout
    assert not output.exists()


def test_tiny_time_limit_reports_incumbent_or_preserves_prior_artifacts(
    tmp_path: Path,
) -> None:
    output = tmp_path / "output"
    seeded = _seed_artifacts(output)

    result = _run_cli(DEFAULT_SCENARIO, output, "--time-limit", "0.001")

    if result.returncode == 0:
        payload = _assert_complete_artifacts(output)
        assert payload["classification"] in {"optimal", "feasible_incumbent"}
        assert f"classification: {payload['classification']}" in result.stdout
        assert payload["verification"]["violations"] == []
        return
    assert result.returncode == 3, result.stdout + result.stderr
    assert "classification: no_incumbent" in result.stdout
    assert {name: (output / name).read_bytes() for name in ALL_ARTIFACTS} == seeded
