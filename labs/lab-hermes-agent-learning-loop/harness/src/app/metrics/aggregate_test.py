from __future__ import annotations

from pathlib import Path

import pytest

from app.cells.record import write_record
from app.commands.run import CELLS
from app.errors import ReportError
from app.metrics.aggregate import latest, load_records, summarise
from app.metrics.cost import GEMMA_PRICE_PER_M, cost_usd
from app.metrics.factory_test import make_record, write_matrix


def test_cost_usd() -> None:
    assert GEMMA_PRICE_PER_M == (0.15, 0.60)
    assert cost_usd(1_000_000, 1_000_000) == pytest.approx(0.75)
    assert cost_usd(0, 0) == 0.0


def test_summarise_orders_cells(tmp_path: Path) -> None:
    write_matrix(tmp_path)
    records = load_records(tmp_path)
    assert [s.cell for s in summarise(records)] == list(CELLS)


def test_load_records_reads_runs_subfolder(tmp_path: Path) -> None:
    write_record(tmp_path / "runs" / "flat-cold" / "r1", make_record("flat-cold"))
    assert [r.cell for r in load_records(tmp_path)] == ["flat-cold"]


def test_bad_record_is_a_report_error(tmp_path: Path) -> None:
    path = tmp_path / "full-cold" / "r1" / "run.json"
    path.parent.mkdir(parents=True)
    path.write_text("{not json")
    with pytest.raises(ReportError):
        load_records(tmp_path)


def test_mean_min_max_for_repeats(tmp_path: Path) -> None:
    for repeat, f1, wall in (("r1", 0.6, 50.0), ("r2", 1.0, 150.0)):
        score = {"f1": f1, "by_category": {"ip": {"f1": f1}}}
        rec = make_record("full-cold", repeat=repeat, score=score, wall_seconds=wall)
        write_record(tmp_path / "full-cold" / repeat, rec)
    records = load_records(tmp_path)
    (s,) = summarise(records)
    assert (s.runs, s.f1_min, s.f1_max) == (2, 0.6, 1.0)
    assert s.f1_mean == pytest.approx(0.8)
    assert s.wall_range == (50.0, 150.0) and s.wall_mean == 100.0
    assert s.category_f1_mean["ip"] == pytest.approx(0.8)
    latest_rec = latest(records, "full-cold")
    assert latest_rec is not None and latest_rec.repeat == "r2"


def test_latest_orders_numerically(tmp_path: Path) -> None:
    for repeat in ("r2", "r10"):
        write_record(
            tmp_path / "full-cold" / repeat, make_record("full-cold", repeat=repeat)
        )
    found = latest(load_records(tmp_path), "full-cold")
    assert found is not None and found.repeat == "r10"


def test_tokens_and_cost_parts(tmp_path: Path) -> None:
    follow = {
        "input_tokens": 300,
        "output_tokens": 30,
        "children_tokens": {"input": 100, "output": 10},
    }
    rec = make_record("full-cold", follow_up=follow)
    write_record(tmp_path / "full-cold" / "r1", rec)
    (s,) = summarise(load_records(tmp_path))
    assert s.total_tokens_mean == 1650  # parent 1100 + children 550
    assert (s.parent_tokens_mean, s.children_tokens_mean) == (1100, 550)
    assert s.overhead_tokens_mean == 440 + 220  # follow-up (+children) + review
    in_tok, out_tok = 1000 + 500 + 400 + 200, 100 + 50 + 40 + 20
    assert s.cost_mean_usd == pytest.approx(cost_usd(in_tok, out_tok))
    assert s.subagents_mean == 1
