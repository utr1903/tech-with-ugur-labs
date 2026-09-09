"""The default: backtest, then report."""

from __future__ import annotations

from app.commands import backtest, report


def run() -> int:
    """The default: backtest, then report."""
    return backtest.run() or report.run()
