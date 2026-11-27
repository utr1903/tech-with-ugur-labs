"""What every command that runs questions repeatedly shares."""

from __future__ import annotations

from pathlib import Path

from app.logging_setup import Logger
from app.runs.record import RunRecord
from app.runs.store import next_run_numbers


def choose_run_numbers(
    results_dir: Path,
    tool: str,
    qid: str,
    *,
    runs: int,
    overwrite: bool,
    log: Logger,
) -> tuple[int, ...]:
    """Run numbers to execute: from 1 when overwriting, else the next free ones."""
    if overwrite:
        log.info("Overwriting from run 1.", question_id=qid)
        return tuple(range(1, runs + 1))
    return next_run_numbers(results_dir, tool, qid, runs)


def summary_line(record: RunRecord) -> str:
    """The one line a command prints per finished run."""
    head = f"{record.question_id} run {record.run}: {record.status}"
    if record.status == "completed":
        return f"{head} in {record.wall_seconds:.0f} s, {len(record.sources)} sources"
    return f"{head} after {record.wall_seconds:.0f} s"
