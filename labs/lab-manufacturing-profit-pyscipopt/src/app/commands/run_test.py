"""Command orchestration tests, including preservation of old artifacts."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.commands import run as run_command
from app.errors import NoIncumbentError, ScenarioError, VerificationError
from app.logging_setup import Logger
from app.model import DecisionValues, SolveResult


def _sentinel_artifacts(output_dir: Path) -> tuple[Path, Path]:
    """Create recognizable result bytes that a failed command must preserve."""
    output_dir.mkdir()
    csv_path = output_dir / "annual_plan.csv"
    json_path = output_dir / "solution.json"
    csv_path.write_bytes(b"previous csv\n")
    json_path.write_bytes(b"previous json\n")
    return csv_path, json_path


def _default_scenario_path() -> Path:
    """Return the lab's documented YAML source for command integration tests."""
    return Path(__file__).resolve().parents[3] / "scenario.yaml"


def _assert_sentinels_unchanged(csv_path: Path, json_path: Path) -> None:
    """Assert both previously published artifact byte streams are untouched."""
    assert csv_path.read_bytes() == b"previous csv\n"
    assert json_path.read_bytes() == b"previous json\n"


def _fail_if_writer_called(*_args: object, **_kwargs: object) -> None:
    """Fail a command test if an unsuccessful path reaches persistence."""
    raise AssertionError("write_results was called")


def _worked_result() -> SolveResult:
    """Return a complete incumbent suitable for forced verification failure."""
    return SolveResult(
        decisions=DecisionValues(
            workers=np.array([4.0, 4.0, 4.0]),
            researchers=np.array([2.0, 1.0, 0.0]),
            expansion_start=np.array([0.0, 0.0, 0.0]),
            units_produced=np.array([4000.0, 4000.0, 4000.0]),
            unit_cost=np.array([50.0, 43.0, 39.0]),
        ),
        status="optimal",
        objective_usd=282000.0,
        objective_bound_usd=282000.0,
        relative_gap=0.0,
        solve_seconds=0.1,
    )


def test_no_incumbent_preserves_existing_artifacts(
    tmp_path: Path,
    log: Logger,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A time-limit result without decisions fails before persistence."""
    output_dir = tmp_path / "output"
    csv_path, json_path = _sentinel_artifacts(output_dir)
    no_incumbent = SolveResult(None, "timelimit", None, None, None, 0.0)
    monkeypatch.setattr(
        run_command, "solve_model", lambda *_args, **_kwargs: no_incumbent
    )
    monkeypatch.setattr(run_command, "write_results", _fail_if_writer_called)

    with pytest.raises(NoIncumbentError, match="timelimit"):
        run_command.run(
            _default_scenario_path(),
            output_dir,
            time_limit_seconds=None,
            relative_gap=None,
            log=log,
        )

    _assert_sentinels_unchanged(csv_path, json_path)


def test_malformed_yaml_preserves_existing_artifacts(
    tmp_path: Path, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenario parsing fails before model construction or persistence."""
    output_dir = tmp_path / "output"
    csv_path, json_path = _sentinel_artifacts(output_dir)
    scenario_path = tmp_path / "bad.yaml"
    scenario_path.write_text("product: [\n", encoding="utf-8")
    monkeypatch.setattr(run_command, "write_results", _fail_if_writer_called)

    with pytest.raises(ScenarioError):
        run_command.run(
            scenario_path,
            output_dir,
            time_limit_seconds=None,
            relative_gap=None,
            log=log,
        )

    _assert_sentinels_unchanged(csv_path, json_path)


def test_verification_failure_preserves_existing_artifacts(
    tmp_path: Path,
    log: Logger,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A corrupt incumbent cannot replace either existing result file."""
    output_dir = tmp_path / "output"
    csv_path, json_path = _sentinel_artifacts(output_dir)
    monkeypatch.setattr(
        run_command, "solve_model", lambda *_args, **_kwargs: _worked_result()
    )

    def reject_verification(*_args: object, **_kwargs: object) -> None:
        """Represent the independent verifier rejecting solver values."""
        raise VerificationError("forced verification failure")

    monkeypatch.setattr(run_command, "verify_solution", reject_verification)
    monkeypatch.setattr(run_command, "write_results", _fail_if_writer_called)

    with pytest.raises(VerificationError, match="forced"):
        run_command.run(
            _default_scenario_path(),
            output_dir,
            time_limit_seconds=None,
            relative_gap=None,
            log=log,
        )

    _assert_sentinels_unchanged(csv_path, json_path)


@pytest.mark.parametrize(
    ("time_limit", "gap"),
    [
        (float("nan"), None),
        (float("inf"), None),
        (float("-inf"), None),
        (0.0, None),
        (-1.0, None),
        (None, float("nan")),
        (None, float("inf")),
        (None, float("-inf")),
        (None, -0.01),
        (None, 1.0),
    ],
)
def test_rejects_invalid_solver_overrides_before_writing(
    tmp_path: Path,
    log: Logger,
    time_limit: float | None,
    gap: float | None,
) -> None:
    """Overrides enforce finite positive seconds and a finite gap in [0, 1)."""
    output_dir = tmp_path / "output"

    with pytest.raises(ScenarioError):
        run_command.run(
            _default_scenario_path(),
            output_dir,
            time_limit_seconds=time_limit,
            relative_gap=gap,
            log=log,
        )

    assert not output_dir.exists()
