"""The `research` command: run the questions through Local Deep Research."""

from __future__ import annotations

import argparse
import os
import time
from collections.abc import Callable
from datetime import UTC, date, datetime
from pathlib import Path

import httpx

from app.errors import ConfigError
from app.ldr.runner import INSTANCE_PRICE_USD_PER_HOUR, run_ldr_question
from app.ldr.session import LdrSession, ldr_settings_from_env
from app.logging_setup import Logger
from app.output import write_line
from app.questions.catalog import select_questions
from app.runs.batch import choose_run_numbers, summary_line
from app.runs.store import save_run

_DEFAULT_RESULTS_DIR = "/work/results"
_REQUEST_TIMEOUT_SECONDS = 60


def run(
    args: argparse.Namespace,
    *,
    log: Logger,
    today: date | None = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    transport: httpx.BaseTransport | None = None,
) -> None:
    """Runs each selected question `--runs` times, saving every run at once."""
    settings = ldr_settings_from_env(os.environ)
    price = _price(os.environ.get("INSTANCE_PRICE_USD_PER_HOUR"))
    results_dir = Path(os.environ.get("RESULTS_DIR", _DEFAULT_RESULTS_DIR))
    day = today or datetime.now(UTC).date()
    questions = select_questions(args.question)

    with httpx.Client(timeout=_REQUEST_TIMEOUT_SECONDS, transport=transport) as client:
        session = LdrSession(client, settings)
        session.login(log=log)
        for question in questions:
            numbers = choose_run_numbers(
                results_dir,
                "ldr",
                question.id,
                runs=args.runs,
                overwrite=args.overwrite,
                log=log,
            )
            for number in numbers:
                record = run_ldr_question(
                    session,
                    question,
                    run=number,
                    today=day,
                    clock=clock,
                    sleep=sleep,
                    log=log,
                    price_per_hour=price,
                )
                save_run(results_dir, record, overwrite=args.overwrite, log=log)
                write_line(summary_line(record))


def _price(raw: str | None) -> float:
    if raw is None or not raw.strip():
        return INSTANCE_PRICE_USD_PER_HOUR
    try:
        return float(raw)
    except ValueError as err:
        raise ConfigError(
            f"INSTANCE_PRICE_USD_PER_HOUR must be a number, got {raw!r}"
        ) from err
