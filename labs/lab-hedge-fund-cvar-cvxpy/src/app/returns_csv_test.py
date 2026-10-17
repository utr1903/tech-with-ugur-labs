"""Behaviour tests for the reader-supplied return-history loader."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.contracts import Universe
from app.errors import MarketError
from app.logging_setup import Logger
from app.returns_csv import load_returns_csv


def _write_csv(path: Path, header: tuple[str, ...], rows: list[list[float]]) -> Path:
    """Write a minimal return-history CSV and return its path."""
    lines = [",".join(header)]
    lines.extend(",".join(f"{value:.6f}" for value in row) for row in rows)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _write_rows(path: Path, header: tuple[str, ...], rows: list[list[str]]) -> Path:
    """Write a CSV from raw cell text, so a cell can be deliberately broken."""
    lines = [",".join(header), *(",".join(row) for row in rows)]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_it_reads_a_matching_history(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    rows = [[0.01 * (index + 1)] * len(universe.names) for index in range(3)]
    path = _write_csv(tmp_path / "returns.csv", universe.names, rows)

    loaded = load_returns_csv(path, universe, log=log)

    assert loaded.mode == "returns_csv"
    assert loaded.returns.shape == (3, len(universe.names))
    assert loaded.returns[2, 0] == pytest.approx(0.03)
    assert not loaded.returns.flags.writeable


def test_it_rejects_a_column_mismatch(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    short_header = universe.names[:-1]
    path = _write_csv(
        tmp_path / "returns.csv", short_header, [[0.0] * len(short_header)]
    )

    with pytest.raises(MarketError, match="column"):
        load_returns_csv(path, universe, log=log)


def test_it_rejects_reordered_columns(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    swapped = (universe.names[1], universe.names[0], *universe.names[2:])
    path = _write_csv(tmp_path / "returns.csv", swapped, [[0.0] * len(swapped)])

    with pytest.raises(MarketError, match="column"):
        load_returns_csv(path, universe, log=log)


def test_it_names_the_row_and_column_of_a_cell_that_is_not_a_number(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    body = ["0.0"] * len(universe.names)
    body[4] = "not-a-number"
    path = _write_rows(tmp_path / "returns.csv", universe.names, [body])

    with pytest.raises(MarketError, match=f"row 2, column '{universe.names[4]}'"):
        load_returns_csv(path, universe, log=log)


@pytest.mark.parametrize("cell", ["nan", "inf", "-inf"])
def test_it_rejects_a_cell_that_is_not_a_finite_return(
    tmp_path: Path, universe: Universe, log: Logger, cell: str
) -> None:
    """A NaN would flow straight into the loss vector and poison every mean."""
    body = ["0.0"] * len(universe.names)
    body[7] = cell
    path = _write_rows(tmp_path / "returns.csv", universe.names, [body])

    with pytest.raises(MarketError, match=f"row 2, column '{universe.names[7]}'"):
        load_returns_csv(path, universe, log=log)


def test_it_rejects_a_row_of_the_wrong_width(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    path = _write_rows(tmp_path / "returns.csv", universe.names, [["0.0", "0.0"]])

    with pytest.raises(MarketError, match="row 2 holds 2 values"):
        load_returns_csv(path, universe, log=log)


def test_it_rejects_a_header_with_no_rows(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    path = _write_csv(tmp_path / "returns.csv", universe.names, [])

    with pytest.raises(MarketError, match="no return rows"):
        load_returns_csv(path, universe, log=log)


def test_it_rejects_an_empty_file(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    path = tmp_path / "returns.csv"
    path.write_text("", encoding="utf-8")

    with pytest.raises(MarketError, match="is empty"):
        load_returns_csv(path, universe, log=log)


def test_it_reports_a_missing_file(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    with pytest.raises(MarketError, match="could not read"):
        load_returns_csv(tmp_path / "absent.csv", universe, log=log)
