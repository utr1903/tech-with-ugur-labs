from __future__ import annotations

from pathlib import Path

from app.logging_setup import get_logger
from app.runs.batch import choose_run_numbers, summary_line
from app.runs.record import RunRecord
from app.runs.store import save_run


def _record(run: int, status: str = "completed") -> RunRecord:
    return RunRecord(
        tool="gemini",
        question_id="q1-kev",
        run=run,
        started_at="2026-11-01T00:00:00+00:00",
        wall_seconds=12.4,
        status=status,
        report="",
        sources=("https://a",),
        usage={},
        cost_usd=None,
        meta={},
    )


def test_numbers_skip_used_ones_unless_overwriting(tmp_path: Path) -> None:
    log = get_logger()
    save_run(tmp_path, _record(1), overwrite=False, log=log)

    free = choose_run_numbers(
        tmp_path, "gemini", "q1-kev", runs=2, overwrite=False, log=log
    )
    over = choose_run_numbers(
        tmp_path, "gemini", "q1-kev", runs=2, overwrite=True, log=log
    )

    assert (free, over) == ((2, 3), (1, 2))


def test_summary_lines() -> None:
    assert summary_line(_record(1)) == "q1-kev run 1: completed in 12 s, 1 sources"
    assert summary_line(_record(2, "failed")) == "q1-kev run 2: failed after 12 s"
