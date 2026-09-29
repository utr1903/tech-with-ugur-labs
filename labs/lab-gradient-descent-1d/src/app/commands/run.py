"""Run the fixed three-start experiment and write its reader artifacts."""

from __future__ import annotations

from pathlib import Path

from app.experiment import Iteration, gradient_descent
from app.logging_setup import Logger
from app.output import write_tables
from app.plotting import write_plot


def run(*, output_dir: Path, log: Logger) -> tuple[Iteration, ...]:
    """Perform 100 updates from each start and return all 303 states."""
    log.info("Running experiment...", output_dir=str(output_dir))
    try:
        rows = tuple(
            row
            for name, start in (("left", -2.6), ("center", 0.5), ("right", 2.6))
            for row in gradient_descent(start, 0.04, 100, run=name, log=log)
        )
        write_tables(rows, output_dir, log=log)
        write_plot(rows, output_dir / "gradient-descent.png", log=log)
    except Exception:
        log.exception("Running experiment failed.", output_dir=str(output_dir))
        raise
    else:
        log.info("Running experiment succeeded.", rows=len(rows))
        return rows
