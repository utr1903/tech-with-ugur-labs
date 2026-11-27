"""Loads run records and averages them per matrix cell."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from statistics import fmean

from app.cells.names import CELLS
from app.cells.record import CellRecord
from app.cells.stream import COMPLETED
from app.errors import ReportError
from app.metrics.cost import cost_usd
from app.metrics.numbers import main_tokens, mapping, num, overhead_io, total_io
from app.scoring.score import CATEGORIES

TOOLS = ("delegate_task", "execute_code", "skill_manage", "skill_view", "terminal")
_RUN = re.compile(r"^r(\d+)$")


@dataclass(frozen=True)
class CellSummary:
    """One matrix cell averaged over its repeats.

    The means and ranges cover only the ok runs (completed with a valid
    report); `failed` names the others. A cell with no ok run averages all
    of its runs, so it still shows what happened.
    """

    cell: str
    runs: int
    ok_runs: int
    failed: tuple[str, ...]
    f1_mean: float
    f1_min: float
    f1_max: float
    total_tokens_mean: float
    total_tokens_range: tuple[float, float]
    parent_tokens_mean: float
    children_tokens_mean: float
    subagents_mean: float
    tool_means: dict[str, float]
    wall_mean: float
    wall_range: tuple[float, float]
    learning_paths: tuple[str, ...]
    skill_loaded_runs: int
    skill_patched_runs: int
    overhead_tokens_mean: float
    cost_mean_usd: float
    category_means: dict[str, tuple[float, float, float]]


def runs_root(results: Path) -> Path:
    """The folder holding the per-cell run folders."""
    return results / "runs"


def _repeat_number(record: CellRecord) -> int:
    match = _RUN.match(record.repeat)
    return int(match[1]) if match else 0


def load_records(results: Path) -> list[CellRecord]:
    """Every `run.json` under the cell folders, cell order then repeat order."""
    root = runs_root(results)
    records: list[CellRecord] = []
    for cell in CELLS:
        for path in sorted((root / cell).glob("r*/run.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                records.append(CellRecord(**data))
            except (OSError, ValueError, TypeError) as err:
                raise ReportError(f"Cannot read run record {path}: {err}") from err
    return sorted(records, key=lambda r: (CELLS.index(r.cell), _repeat_number(r)))


def latest(records: list[CellRecord], cell: str) -> CellRecord | None:
    """The highest repeat of `cell`, if any."""
    mine = [r for r in records if r.cell == cell]
    return max(mine, key=_repeat_number) if mine else None


def _f1(rec: CellRecord) -> float:
    return num(rec.score.get("f1"))


def is_ok(rec: CellRecord) -> bool:
    """Completed with a schema-valid report."""
    return rec.status == COMPLETED and rec.score.get("format_failure") is False


def _cat_mean(recs: list[CellRecord], category: str) -> tuple[float, float, float]:
    cats = [mapping(mapping(r.score.get("by_category")).get(category)) for r in recs]
    p, r, f1 = (
        fmean(num(c.get(k)) for c in cats) for k in ("precision", "recall", "f1")
    )
    return p, r, f1


def _summary(cell: str, every: list[CellRecord]) -> CellSummary:
    ok = [r for r in every if is_ok(r)]
    recs = ok or every
    f1s = [_f1(r) for r in recs]
    totals = [float(sum(main_tokens(r))) for r in recs]
    walls = [r.wall_seconds for r in recs]
    costs = [cost_usd(*total_io(r)) for r in recs]
    return CellSummary(
        cell=cell,
        runs=len(every),
        ok_runs=len(ok),
        failed=tuple(r.repeat for r in every if not is_ok(r)),
        f1_mean=fmean(f1s),
        f1_min=min(f1s),
        f1_max=max(f1s),
        total_tokens_mean=fmean(totals),
        total_tokens_range=(min(totals), max(totals)),
        parent_tokens_mean=fmean(main_tokens(r)[0] for r in recs),
        children_tokens_mean=fmean(main_tokens(r)[1] for r in recs),
        subagents_mean=fmean(len(r.children) for r in recs),
        tool_means={t: fmean(r.tools.get(t, 0) for r in recs) for t in TOOLS},
        wall_mean=fmean(walls),
        wall_range=(min(walls), max(walls)),
        learning_paths=tuple(r.learning_path for r in every),
        skill_loaded_runs=sum(r.skill_loaded for r in every),
        skill_patched_runs=sum(r.skill_patched for r in every),
        overhead_tokens_mean=fmean(sum(overhead_io(r)) for r in recs),
        cost_mean_usd=fmean(costs),
        category_means={c: _cat_mean(recs, c) for c in CATEGORIES},
    )


def summarise(records: list[CellRecord]) -> list[CellSummary]:
    """One summary per cell that has records, in the fixed cell order."""
    return [
        _summary(cell, [r for r in records if r.cell == cell])
        for cell in CELLS
        if any(r.cell == cell for r in records)
    ]
