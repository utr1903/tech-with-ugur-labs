from __future__ import annotations

import csv
import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.contracts import DecisionValues, Scenario, SolveMetadata, SolveResult
from app.errors import VerificationError
from app.logging_setup import get_logger
from app.reporting.artifacts import write_artifacts
from app.reporting.serialization import RunSource
from app.verification import verify_solution


@pytest.fixture
def result(feasible_values: DecisionValues) -> SolveResult:
    return SolveResult(
        SolveMetadata("timelimit", True, 0.1, 100.0, 0.2, 1, 256, 221, "10.0.2"),
        feasible_values,
    )


def test_no_incumbent_preserves_previous(
    tmp_path: Path, scenario: Scenario, result: SolveResult
) -> None:
    prior = tmp_path / "solution.json"
    prior.write_text("previous-valid")
    none = SolveResult(replace(result.metadata, has_incumbent=False), None)
    assert write_artifacts(tmp_path, scenario, none, None, log=get_logger()) == ()
    assert prior.read_text() == "previous-valid"


@pytest.mark.parametrize(
    ("status", "label"),
    [
        ("timelimit", "feasible_incumbent"),
        ("gaplimit", "feasible_incumbent"),
        ("optimal", "optimal"),
    ],
)
def test_complete_artifacts(
    tmp_path: Path, scenario: Scenario, result: SolveResult, status: str, label: str
) -> None:
    assert result.decisions is not None
    result = replace(
        result,
        metadata=replace(
            result.metadata,
            status=status,
            relative_gap=0.0 if status == "optimal" else 0.2,
        ),
    )
    assert result.decisions is not None
    report = verify_solution(scenario, result.decisions)
    source = RunSource("scenario.yaml", "abc123", None, 0.2)
    written = write_artifacts(
        tmp_path, scenario, result, report, log=get_logger(), source=source
    )
    assert len(written) == 11
    payload = json.loads((tmp_path / "solution.json").read_text())
    assert payload["classification"] == label
    assert payload["source"]["sha256"] == "abc123"
    assert payload["metadata"]["variable_count"] == 256
    assert payload["cumulative_cash_musd"] == pytest.approx(report.cash.net_cash.sum())
    assert payload["decisions"]["cash_auxiliary"] == -1000.0
    assert set(payload["decisions"]) == set(result.decisions.__dataclass_fields__)
    for name, rows in [
        ("annual_cash", 3),
        ("budget_utilization", 15),
        ("investments", 12),
        ("headcount", 48),
        ("rd_and_knowledge", 12),
        ("market_plan", 24),
        ("factory_plan", 12),
        ("shipments", 48),
    ]:
        with (tmp_path / f"{name}.csv").open() as stream:
            assert len(list(csv.DictReader(stream))) == rows
    for name in ("cash_composition", "investment_production"):
        assert (tmp_path / f"{name}.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_failed_verification_writes_nothing(
    tmp_path: Path, scenario: Scenario, result: SolveResult
) -> None:
    assert result.decisions is not None
    bad = replace(result.decisions, cash_auxiliary=1000.0)
    with pytest.raises(VerificationError):
        write_artifacts(
            tmp_path,
            scenario,
            replace(result, decisions=bad),
            verify_solution(scenario, bad),
            log=get_logger(),
        )
    assert list(tmp_path.iterdir()) == []


def test_failed_staging_preserves_all_previous_files(
    tmp_path: Path,
    scenario: Scenario,
    result: SolveResult,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from matplotlib.figure import Figure

    from app.errors import ArtifactError

    def fail_save(self: Figure, *args: object, **kwargs: object) -> None:
        del self, args, kwargs
        raise OSError("simulated full disk")

    assert result.decisions is not None
    prior = tmp_path / "solution.json"
    prior.write_text("previous-valid")
    monkeypatch.setattr(Figure, "savefig", fail_save)
    with pytest.raises(ArtifactError):
        write_artifacts(
            tmp_path,
            scenario,
            result,
            verify_solution(scenario, result.decisions),
            log=get_logger(),
        )
    assert prior.read_text() == "previous-valid"
    assert list(tmp_path.iterdir()) == [prior]
