"""The `score` command: aggregate every stored run into a scoreboard."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from app.commands.truth import KEV_FILE, MSFT_FILE
from app.errors import RunStoreError
from app.logging_setup import Logger
from app.output import write_line
from app.report.aggregate import newest_run_date, score_runs, summarise
from app.report.markdown import render_scoreboard, render_summary_table
from app.runs.record import RunRecord
from app.runs.store import load_runs
from app.truth.store import load_kev_truth, load_msft_truth

_DEFAULT_RESULTS_DIR = "/work/results"
_DEFAULT_DATA_DIR = "/work/data"
SCOREBOARD_FILE = "scoreboard.md"


def run(args: argparse.Namespace, *, log: Logger) -> None:
    """Writes `scoreboard.md` under the results directory and prints the summary."""
    results_dir = Path(os.environ.get("RESULTS_DIR", _DEFAULT_RESULTS_DIR))
    truth_dir = Path(os.environ.get("DATA_DIR", _DEFAULT_DATA_DIR)) / "truth"
    path = results_dir / SCOREBOARD_FILE

    try:
        log.info("Scoring runs...", command=args.command, results_dir=str(results_dir))
        runs = load_runs(results_dir, log=log)
        _require_runs(runs, results_dir)
        scored = score_runs(
            runs,
            load_kev_truth(truth_dir / KEV_FILE),
            load_msft_truth(truth_dir / MSFT_FILE),
        )
        summaries = summarise(scored)
        board = render_scoreboard(summaries, scored, generated_on=newest_run_date(runs))
        path.write_text(board, encoding="utf-8")
    except (RunStoreError, OSError):
        log.exception("Scoring runs failed.", results_dir=str(results_dir))
        raise
    else:
        log.info("Scoring runs succeeded.", runs=len(runs), path=str(path))
        write_line(render_summary_table(summaries))
        write_line(f"Wrote {path}")


def _require_runs(runs: tuple[RunRecord, ...], results_dir: Path) -> None:
    if not runs:
        raise RunStoreError(
            f"no run files under {results_dir / 'runs'}; "
            "run make research or make frontier first"
        )
