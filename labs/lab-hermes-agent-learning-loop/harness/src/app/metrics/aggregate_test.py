from __future__ import annotations

from pathlib import Path

import pytest

from app.cells.names import CELLS
from app.cells.record import write_record
from app.conftest import make_record, write_matrix
from app.errors import ReportError
from app.metrics.aggregate import latest, load_records, summarise
from app.metrics.cost import GEMMA_PRICE_PER_M, cost_usd


def test_cost_usd() -> None:
    assert GEMMA_PRICE_PER_M == (0.15, 0.60)
    assert cost_usd(1_000_000, 1_000_000) == pytest.approx(0.75)
    assert cost_usd(0, 0) == 0.0


def test_summarise_orders_cells(tmp_path: Path) -> None:
    write_matrix(tmp_path)
    records = load_records(tmp_path)
    assert [s.cell for s in summarise(records)] == list(CELLS)


def test_load_records_ignores_flat_layout(tmp_path: Path) -> None:
    write_record(tmp_path / "flat-cold" / "r1", make_record("flat-cold"))
    assert load_records(tmp_path) == []
    write_record(tmp_path / "runs" / "flat-cold" / "r1", make_record("flat-cold"))
    assert [r.cell for r in load_records(tmp_path)] == ["flat-cold"]


def test_bad_record_is_a_report_error(tmp_path: Path) -> None:
    path = tmp_path / "runs" / "full-cold" / "r1" / "run.json"
    path.parent.mkdir(parents=True)
    path.write_text("{not json")
    with pytest.raises(ReportError):
        load_records(tmp_path)


def test_mean_min_max_for_repeats(tmp_path: Path) -> None:
    for repeat, f1, wall in (("r1", 0.6, 50.0), ("r2", 1.0, 150.0)):
        score = {"f1": f1, "by_category": {"ip": {"f1": f1}}}
        rec = make_record("full-cold", repeat=repeat, score=score, wall_seconds=wall)
        write_record(tmp_path / "runs" / "full-cold" / repeat, rec)
    records = load_records(tmp_path)
    (s,) = summarise(records)
    assert (s.runs, s.f1_min, s.f1_max) == (2, 0.6, 1.0)
    assert s.f1_mean == pytest.approx(0.8)
    assert s.wall_range == (50.0, 150.0) and s.wall_mean == 100.0
    assert s.category_means["ip"][2] == pytest.approx(0.8)
    latest_rec = latest(records, "full-cold")
    assert latest_rec is not None and latest_rec.repeat == "r2"


def test_latest_orders_numerically(tmp_path: Path) -> None:
    for repeat in ("r2", "r10"):
        write_record(
            tmp_path / "runs" / "full-cold" / repeat,
            make_record("full-cold", repeat=repeat),
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
    write_record(tmp_path / "runs" / "full-cold" / "r1", rec)
    (s,) = summarise(load_records(tmp_path))
    assert s.total_tokens_mean == 1650  # parent 1100 + children 550
    assert (s.parent_tokens_mean, s.children_tokens_mean) == (1100, 550)
    assert s.overhead_tokens_mean == 440 + 220  # follow-up (+children) + review
    in_tok, out_tok = 1000 + 500 + 400 + 200, 100 + 50 + 40 + 20
    assert s.cost_mean_usd == pytest.approx(cost_usd(in_tok, out_tok))
    assert s.subagents_mean == 1


def _repeats(tmp_path: Path, *variants: dict[str, object]) -> None:
    for n, over in enumerate(variants, 1):
        rec = make_record("full-warm", repeat=f"r{n}", **over)
        write_record(tmp_path / "runs" / "full-warm" / f"r{n}", rec)


def test_skill_use_is_counted_per_run(tmp_path: Path) -> None:
    _repeats(
        tmp_path,
        {"skill_loaded": True, "skill_patched": True, "tools": {"skill_manage": 2}},
        {"skill_loaded": True},
        {},
    )
    (s,) = summarise(load_records(tmp_path))
    assert (s.skill_loaded_runs, s.skill_patched_runs) == (2, 1)
    assert s.tool_means["skill_manage"] == pytest.approx(2 / 3)


def test_failed_runs_are_left_out_of_the_means(tmp_path: Path) -> None:
    bad_format = {"f1": 0.0, "format_failure": True}
    _repeats(
        tmp_path,
        {"score": {"f1": 0.8, "format_failure": False}, "wall_seconds": 10.0},
        {"status": "error", "score": {"f1": 0.0}, "wall_seconds": 1800.0},
        {"score": bad_format, "wall_seconds": 5.0},
        {"score": {"f1": 1.0, "format_failure": False}, "wall_seconds": 30.0},
    )
    (s,) = summarise(load_records(tmp_path))
    assert (s.runs, s.ok_runs, s.failed) == (4, 2, ("r2", "r3"))
    assert s.f1_mean == pytest.approx(0.9) and s.f1_min == 0.8
    assert s.wall_range == (10.0, 30.0)


def test_cell_with_no_ok_run_still_has_numbers(tmp_path: Path) -> None:
    _repeats(tmp_path, {"status": "error", "score": {"f1": 0.2}})
    (s,) = summarise(load_records(tmp_path))
    assert (s.ok_runs, s.failed) == (0, ("r1",)) and s.f1_mean == pytest.approx(0.2)


def test_category_precision_and_recall(tmp_path: Path) -> None:
    cat = {"precision": 0.5, "recall": 1.0, "f1": 0.67}
    score = {"f1": 0.67, "format_failure": False, "by_category": {"ip": cat}}
    _repeats(tmp_path, {"score": score})
    (s,) = summarise(load_records(tmp_path))
    assert s.category_means["ip"] == pytest.approx((0.5, 1.0, 0.67))
