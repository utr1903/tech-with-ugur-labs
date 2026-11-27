from __future__ import annotations

import json
import shutil
from collections.abc import Callable
from pathlib import Path

import pytest

from app.cells.record import write_record
from app.commands.assert_e2e import run
from app.commands.report import run as report
from app.conftest import make_record, settings_for, write_matrix
from app.envvars import Settings
from app.errors import LabError
from app.logging_setup import get_logger

LOG = get_logger()


def _passing(tmp_path: Path) -> Settings:
    settings = settings_for(tmp_path)
    res = settings.results_dir
    write_matrix(res)
    report(settings, log=LOG)
    (res / "fixtures-check.txt").write_text("ok\nexit=0\n")
    (res / "leak-check.txt").write_text("exit=0\n")
    curator = res / "curator"
    curator.mkdir()
    (curator / "exit-codes.txt").write_text(
        "full-learn dry-run=0 status=0\nflat-learn dry-run=0 status=0\n"
    )
    for home in ("full-learn", "flat-learn"):
        (curator / f"{home}-status.txt").write_text("s")
    bundled = json.dumps(["skills/bundled/SKILL.md"])
    for home in ("full-learn", "full-control", "flat-learn", "flat-control"):
        (res / f"{home}-baseline.json").write_text(bundled)
    return settings


def _lines(capsys: pytest.CaptureFixture[str]) -> list[str]:
    return capsys.readouterr().out.splitlines()


def test_assert_all_pass(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    run(_passing(tmp_path), log=LOG)
    out = [ln for ln in _lines(capsys) if ln.startswith(("PASS", "FAIL"))]
    assert [ln.split()[:2] for ln in out] == [["PASS", str(n)] for n in range(1, 9)]


def test_assert_flat_with_delegate_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _passing(tmp_path)
    tools = {"terminal": 1, "delegate_task": 1}
    rec = make_record("flat-warm", tools=tools)
    write_record(settings.results_dir / "runs" / "flat-warm" / "r1", rec)
    with pytest.raises(LabError):
        run(settings, log=LOG)
    assert any(ln.startswith("FAIL 6") for ln in _lines(capsys))


def test_assert_full_f1_below_threshold_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _passing(tmp_path)
    run(settings, f1_threshold=0.9, log=LOG)
    _lines(capsys)
    with pytest.raises(LabError):
        run(settings, f1_threshold=0.95, log=LOG)
    assert any(ln.startswith("FAIL 4") for ln in _lines(capsys))


def test_flat_f1_never_fails(tmp_path: Path) -> None:
    settings = _passing(tmp_path)
    rec = make_record("flat-cold", score={"f1": 0.0, "format_failure": False})
    write_record(settings.results_dir / "runs" / "flat-cold" / "r2", rec)
    run(settings, log=LOG)


def test_wrong_version_and_leak_and_curator_fail(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _passing(tmp_path)
    res = settings.results_dir
    write_record(
        res / "runs" / "full-warm" / "r2",
        make_record("full-warm", repeat="r2", hermes_version="0.1", skill_loaded=True),
    )
    (res / "leak-check.txt").write_text("exit=1\n")
    (res / "curator" / "exit-codes.txt").write_text("full-learn dry-run=1 status=0\n")
    with pytest.raises(LabError):
        run(settings, log=LOG)
    failed = {ln.split()[1] for ln in _lines(capsys) if ln.startswith("FAIL")}
    assert failed == {"2", "7", "8"}


def test_cold_without_skill_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _passing(tmp_path)
    write_record(
        settings.results_dir / "runs" / "full-cold" / "r2",
        make_record("full-cold", repeat="r2"),
    )
    with pytest.raises(LabError):
        run(settings, log=LOG)
    assert any(ln.startswith("FAIL 5") for ln in _lines(capsys))


@pytest.mark.parametrize("status", ["run.failed", "completed", "error", ""])
def test_cell_status_other_than_completed_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], status: str
) -> None:
    settings = _passing(tmp_path)
    write_record(
        settings.results_dir / "runs" / "full-warm" / "r2",
        make_record("full-warm", repeat="r2", status=status, skill_loaded=True),
    )
    with pytest.raises(LabError):
        run(settings, log=LOG)
    failed = {ln.split()[1] for ln in _lines(capsys) if ln.startswith("FAIL")}
    assert "3" in failed


def test_earlier_repeats_are_reported_not_asserted(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = _passing(tmp_path)
    runs = settings.results_dir / "runs" / "full-warm"
    write_record(runs / "r1", make_record("full-warm", status="error", error="x"))
    write_record(runs / "r2", make_record("full-warm", repeat="r2", skill_loaded=True))
    run(settings, log=LOG)
    out = _lines(capsys)
    assert "INFO earlier repeat full-warm r1: status=error ok=False" in out
    assert "INFO earlier repeat full-cold r1: status=run.completed ok=True" not in out
    assert all(not ln.startswith("FAIL") for ln in out)


def _record(cell: str, **over: object) -> Callable[[Path], object]:
    def mutate(res: Path) -> None:
        base: dict[str, object] = {"repeat": "r2"}
        if cell == "full-warm":
            base["skill_loaded"] = True
        rec = make_record(cell, **{**base, **over})
        write_record(res / "runs" / cell / "r2", rec)

    return mutate


def _baseline(home: str, text: str) -> Callable[[Path], object]:
    return lambda res: (res / f"{home}-baseline.json").write_text(text)


_LEARNED = json.dumps(["skills/bundled/SKILL.md", "skills/triage/SKILL.md"])

FAIL_CASES: dict[str, tuple[Callable[[Path], object], str]] = {
    "fixtures check missing": (
        lambda res: (res / "fixtures-check.txt").unlink(),
        "1",
    ),
    "model mismatch": (_record("flat-cold", model="other/model"), "2"),
    "missing cell": (lambda res: shutil.rmtree(res / "runs" / "flat-warm"), "3"),
    "format failure with completed status": (
        _record("flat-cold", score={"f1": 0.0, "format_failure": True}),
        "3",
    ),
    "warm did not load the skill": (_record("full-warm", skill_loaded=False), "5"),
    "control home had agent skills": (_baseline("full-control", _LEARNED), "5"),
    "flat control home had agent skills": (_baseline("flat-control", _LEARNED), "5"),
    "control baseline missing": (
        lambda res: (res / "full-control-baseline.json").unlink(),
        "5",
    ),
    "full cell without execute_code": (
        _record("full-control", tools={"terminal": 1, "delegate_task": 1}),
        "6",
    ),
    "metrics row missing": (
        lambda res: (res / "metrics.md").write_text(
            (res / "metrics.md").read_text().replace("| flat-warm |", "| x |")
        ),
        "7",
    ),
    "leak check missing": (lambda res: (res / "leak-check.txt").unlink(), "8"),
}


@pytest.mark.parametrize("case", sorted(FAIL_CASES))
def test_each_gate_fails_closed(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], case: str
) -> None:
    mutate, number = FAIL_CASES[case]
    settings = _passing(tmp_path)
    mutate(settings.results_dir)
    with pytest.raises(LabError):
        run(settings, log=LOG)
    failed = {ln.split()[1] for ln in _lines(capsys) if ln.startswith("FAIL")}
    assert number in failed
