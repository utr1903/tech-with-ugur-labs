"""The default: backtest, then report."""

from __future__ import annotations

from app.commands import backtest, report
from app.logging_setup import Logger


def run(*, log: Logger) -> None:
    """The default: backtest, then report."""
    backtest.run(log=log)
    report.run(log=log)
