"""Read a reader-supplied return history in place of the seeded generator.

The generator exists so the lab is reproducible from nothing, but the model
does not care where its `[S, N]` matrix came from. Point `returns_csv` in
`scenario.yaml` at a file shaped like the one this module reads and every
solve, check and chart in the lab runs on your own history instead.

Parsing is strict on purpose. A silently reordered column would swap two
companies' returns, which in a long/short book means pricing a long as a
short — so the header has to name every universe column in the universe's
own order, every row has to be the right width, and every cell has to be a
finite number.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np

from app.contracts import FloatArray, MarketScenarios, Universe, frozen_float_array
from app.errors import MarketError
from app.logging_setup import Logger
from app.tailrisk import array_digest

CSV_MODE = "returns_csv"
_PREVIEW_COLUMNS = 3


def _require_header(header: list[str], names: tuple[str, ...]) -> None:
    """Reject a header that is not exactly the universe's columns, in order."""
    if tuple(header) != names:
        raise MarketError(
            f"the header row must name every universe column in order: expected "
            f"{len(names)} columns starting {names[:_PREVIEW_COLUMNS]}, got "
            f"{len(header)} columns starting {tuple(header[:_PREVIEW_COLUMNS])}"
        )


def _parse_cell(cell: str, column: str, line: int) -> float:
    """Convert one cell to a finite float, naming where it came from."""
    try:
        value = float(cell)
    except ValueError as err:
        raise MarketError(
            f"row {line}, column {column!r} is not a number: {cell!r}"
        ) from err
    if not math.isfinite(value):
        raise MarketError(
            f"row {line}, column {column!r} is not a finite return: {cell!r}"
        )
    return value


def _parse_row(row: list[str], names: tuple[str, ...], line: int) -> list[float]:
    """Convert one data row into floats, naming the offending column."""
    if len(row) != len(names):
        raise MarketError(
            f"row {line} holds {len(row)} values but the header declares "
            f"{len(names)} columns"
        )
    return [_parse_cell(cell, names[column], line) for column, cell in enumerate(row)]


def _read_returns(path: Path, names: tuple[str, ...]) -> FloatArray:
    """Read a whole return-history file into a `[periods, N]` matrix."""
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    if not rows:
        raise MarketError(f"{path} is empty")
    _require_header([cell.strip() for cell in rows[0]], names)
    values = [
        _parse_row(row, names, line) for line, row in enumerate(rows[1:], start=2)
    ]
    if not values:
        raise MarketError(f"{path} has a header row but no return rows")
    return frozen_float_array(np.array(values, dtype=np.float64))


def load_returns_csv(path: Path, universe: Universe, *, log: Logger) -> MarketScenarios:
    """Load a reader-supplied return history instead of generating one.

    Args:
        path: The CSV file to read.
        universe: The universe whose column order the file must match.
        log: Logger for the operation boundary.

    Returns:
        The loaded matrix, tagged with mode `"returns_csv"` and seed `0`.

    Raises:
        MarketError: If the file is unreadable, the header does not match, or
            a row is the wrong width, not numeric, or not finite.
    """
    try:
        log.info("Loading return history...", path=str(path))
        returns = _read_returns(path, universe.names)
        scenarios = MarketScenarios(
            returns=returns, mode=CSV_MODE, seed=0, digest=array_digest(returns)
        )
    except MarketError:
        log.exception("Loading return history failed.", path=str(path))
        raise
    except OSError as err:
        log.exception("Loading return history failed.", path=str(path))
        raise MarketError(f"could not read {path}") from err
    else:
        log.info(
            "Loading return history succeeded.",
            path=str(path),
            scenarios=int(scenarios.returns.shape[0]),
            digest=scenarios.digest,
        )
        return scenarios
