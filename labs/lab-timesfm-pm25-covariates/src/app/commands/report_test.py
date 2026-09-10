"""report owns the ChecksFailedError contract: a failed check must reach the
reader (the scoreboard, the [FAIL] line, the verdict) before it propagates."""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest

from app import config
from app.commands import report
from app.errors import ChecksFailedError
from app.eval import artifact
from app.eval.results import ExperimentResult
from app.logging_setup import Logger


def _save_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    results: dict[str, ExperimentResult],
    log: Logger,
) -> None:
    path = tmp_path / "forecasts.npz"
    monkeypatch.setattr(config, "FORECASTS_PATH", path)
    repeat = results["timesfm-univariate"].points[: config.DETERMINISM_ORIGINS]
    artifact.save_artifact(path, results, repeat, log=log)


def test_report_completes_when_every_check_passes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    results: dict[str, ExperimentResult],
    log: Logger,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _save_artifact(tmp_path, monkeypatch, results, log)

    report.run(log=log)

    out = capsys.readouterr().out
    assert "[FAIL]" not in out
    assert "all checks passed" in out


def test_report_prints_the_fail_line_and_verdict_before_raising(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    results: dict[str, ExperimentResult],
    log: Logger,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # Shorten one configuration's arrays by one origin so
    # shapes-and-finiteness is the only check that fails.
    broken = dict(results)
    both = broken["timesfm-both"]
    broken["timesfm-both"] = dataclasses.replace(
        both, points=both.points[:-1], quantiles=both.quantiles[:-1]
    )
    _save_artifact(tmp_path, monkeypatch, broken, log)

    with pytest.raises(ChecksFailedError):
        report.run(log=log)

    # The reader must see the failing row and the verdict before the
    # exception propagates - assert on what was actually written, not
    # just that raising happened.
    out = capsys.readouterr().out
    assert "[FAIL] shapes-and-finiteness" in out
    assert "1 check(s) FAILED" in out
