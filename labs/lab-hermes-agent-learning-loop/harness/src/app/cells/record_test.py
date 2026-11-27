from __future__ import annotations

from pathlib import Path

from app.cells.record import next_run_dir


def test_run_dir_picks_next_free(tmp_path: Path) -> None:
    cell = tmp_path / "full-cold"
    assert next_run_dir(cell) == cell / "r1"
    (cell / "r1").mkdir(parents=True)
    (cell / "r3").mkdir()
    (cell / "notes").mkdir()
    assert next_run_dir(cell) == cell / "r4"
