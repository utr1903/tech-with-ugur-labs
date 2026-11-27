from __future__ import annotations

from pathlib import Path

from app.cells.record import write_record
from app.commands.run import CELLS
from app.metrics.aggregate import load_records, summarise
from app.metrics.factory_test import make_record, write_matrix
from app.metrics.markdown import render


def _render(results: Path) -> str:
    records = load_records(results)
    return render(summarise(records), records, results)


def test_render_has_six_rows(tmp_path: Path) -> None:
    write_matrix(tmp_path)
    text = _render(tmp_path)
    for cell in CELLS:
        assert f"| {cell} | 1 |" in text
    assert "Runs: 2026-11-27 to 2026-11-27" in text
    assert "Hermes version: 0.23.4" in text
    assert "0.90" in text and "reported as measured" in text
    assert text == _render(tmp_path)


def test_render_links_skills(tmp_path: Path) -> None:
    write_matrix(tmp_path)
    (tmp_path / "full-cold" / "r1" / "MEMORY.md").write_text("m")
    text = _render(tmp_path)
    assert "[triage](full-cold/r1/skills/triage/SKILL.md)" in text
    assert "[MEMORY.md](full-cold/r1/MEMORY.md)" in text
    assert "ip / svc-a / 10.0.0.1" in text


def test_render_repeats_show_mean_and_range(tmp_path: Path) -> None:
    for repeat, f1 in (("r1", 0.5), ("r2", 0.9)):
        rec = make_record("flat-cold", repeat=repeat, score={"f1": f1})
        write_record(tmp_path / "flat-cold" / repeat, rec)
    assert "0.70 (0.50–0.90)" in _render(tmp_path)
