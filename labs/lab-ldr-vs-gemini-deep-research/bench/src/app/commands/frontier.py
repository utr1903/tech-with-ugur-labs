"""The `frontier` command: run the questions through Gemini Deep Research."""

from __future__ import annotations

import argparse
import os
import time
from collections.abc import Callable
from datetime import UTC, date, datetime
from pathlib import Path

from app.gemini.client import GenaiInteractions, gemini_settings_from_env
from app.gemini.interactions import InteractionsApi
from app.gemini.runner import run_gemini_question
from app.logging_setup import Logger
from app.output import write_line
from app.questions.catalog import select_questions
from app.runs.batch import choose_run_numbers, summary_line
from app.runs.store import save_run

_DEFAULT_RESULTS_DIR = "/work/results"


def run(
    args: argparse.Namespace,
    *,
    log: Logger,
    today: date | None = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    api: InteractionsApi | None = None,
) -> None:
    """Runs each selected question `--runs` times, saving every run at once."""
    settings = gemini_settings_from_env(os.environ)
    results_dir = Path(os.environ.get("RESULTS_DIR", _DEFAULT_RESULTS_DIR))
    day = today or datetime.now(UTC).date()
    questions = select_questions(args.question)
    interactions = api or GenaiInteractions(settings)

    for question in questions:
        numbers = choose_run_numbers(
            results_dir,
            "gemini",
            question.id,
            runs=args.runs,
            overwrite=args.overwrite,
            log=log,
        )
        for number in numbers:
            record = run_gemini_question(
                interactions,
                settings,
                question,
                run=number,
                today=day,
                clock=clock,
                sleep=sleep,
                log=log,
            )
            save_run(results_dir, record, overwrite=args.overwrite, log=log)
            write_line(summary_line(record))
