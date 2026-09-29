"""Write the experiment's complete iteration tables."""

from __future__ import annotations

import csv
from pathlib import Path

from app.experiment import Iteration
from app.logging_setup import Logger

_COLUMNS = ("run", "iteration", "x", "cost", "slope")


def _cells(row: Iteration) -> tuple[str, str, str, str, str]:
    """Serialize a state once for both table formats."""
    return (
        row.run,
        str(row.iteration),
        repr(row.x),
        repr(row.cost),
        repr(row.slope),
    )


def _markdown_row(cells: tuple[str, ...]) -> str:
    return f"| {' | '.join(cells)} |\n"


def write_tables(rows: tuple[Iteration, ...], directory: Path, *, log: Logger) -> None:
    """Write CSV and Markdown records, creating the output directory."""
    log.info("Writing iteration tables...", directory=str(directory), rows=len(rows))
    try:
        directory.mkdir(parents=True, exist_ok=True)
        with (
            (directory / "iterations.csv").open(
                "w", newline="", encoding="utf-8"
            ) as csv_file,
            (directory / "iterations.md").open("w", encoding="utf-8") as md_file,
        ):
            writer = csv.writer(csv_file)
            writer.writerow(_COLUMNS)
            md_file.write(_markdown_row(_COLUMNS))
            md_file.write(_markdown_row(("---",) * len(_COLUMNS)))
            for row in rows:
                cells = _cells(row)
                writer.writerow(cells)
                md_file.write(_markdown_row(cells))
    except Exception:
        log.exception(
            "Writing iteration tables failed.", directory=str(directory), rows=len(rows)
        )
        raise
    else:
        log.info(
            "Writing iteration tables succeeded.",
            directory=str(directory),
            rows=len(rows),
        )
