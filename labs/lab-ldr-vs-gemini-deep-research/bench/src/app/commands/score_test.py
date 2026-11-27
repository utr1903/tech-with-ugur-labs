from __future__ import annotations

import argparse
import json
from pathlib import Path

import pytest

from app.answers.kev_answer import KevItem
from app.commands import score
from app.errors import RunStoreError
from app.logging_setup import Logger, get_logger
from app.runs.record import RunRecord
from app.runs.store import save_run
from app.truth.edgar import MsftTruth, QuarterTruth
from app.truth.kev import KevTruth
from app.truth.store import kev_truth_to_json, msft_truth_to_json


@pytest.fixture
def log() -> Logger:
    return get_logger()


@pytest.fixture(autouse=True)
def env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    truth_dir = tmp_path / "data" / "truth"
    truth_dir.mkdir(parents=True)
    entry = KevItem("CVE-2026-0001", "A", "p")
    kev = KevTruth("2026-10-01", "2026-10-31", "v", (entry,))
    quarter = QuarterTruth("2025-06-30", 1.0, 1.0, 1.0, False)
    msft = MsftTruth("0000789019", (quarter,))
    (truth_dir / "kev-2026-10.json").write_text(json.dumps(kev_truth_to_json(kev)))
    (truth_dir / "msft-quarters.json").write_text(json.dumps(msft_truth_to_json(msft)))


def _save(tmp_path: Path, log: Logger, *, run: int, started: str, report: str) -> None:
    record = RunRecord(
        tool="ldr",
        question_id="q1-kev",
        run=run,
        started_at=started,
        wall_seconds=30.0,
        status="completed",
        report=report,
        sources=(),
        usage={},
        cost_usd=None,
        meta={},
    )
    save_run(tmp_path / "results", record, overwrite=False, log=log)


def _args() -> argparse.Namespace:
    return argparse.Namespace(command="score")


def test_writes_scoreboard_and_prints_summary(
    tmp_path: Path, log: Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    _save(tmp_path, log, run=1, started="2026-11-01T10:00:00Z", report="prose")

    score.run(_args(), log=log)

    board = (tmp_path / "results" / "scoreboard.md").read_text()
    assert board.startswith("# Scoreboard")
    assert "2026-11-01" in board
    assert "| ldr | q1-kev | 1 |" in capsys.readouterr().out


def test_rescoring_is_byte_identical(tmp_path: Path, log: Logger) -> None:
    _save(tmp_path, log, run=1, started="2026-11-01T10:00:00Z", report="a")
    _save(tmp_path, log, run=3, started="2026-11-02T10:00:00Z", report="b")
    path = tmp_path / "results" / "scoreboard.md"

    score.run(_args(), log=log)
    first = path.read_bytes()
    score.run(_args(), log=log)

    assert path.read_bytes() == first
    assert "2026-11-02" in first.decode()


def test_no_runs_is_error(tmp_path: Path, log: Logger) -> None:
    with pytest.raises(RunStoreError, match="make research or make frontier"):
        score.run(_args(), log=log)

    assert not (tmp_path / "results" / "scoreboard.md").exists()


def test_report_json_block_is_scored(tmp_path: Path, log: Logger) -> None:
    block = "```json\n" + json.dumps({"cves": []}) + "\n```"
    _save(tmp_path, log, run=1, started="2026-11-01T10:00:00Z", report=block)

    score.run(_args(), log=log)

    assert "0.0%" in (tmp_path / "results" / "scoreboard.md").read_text()
