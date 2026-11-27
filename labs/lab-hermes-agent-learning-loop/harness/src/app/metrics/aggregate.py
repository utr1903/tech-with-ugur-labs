"""Loads run records and averages them per matrix cell."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from statistics import fmean

from app.cells.record import CellRecord
from app.commands.run import CELLS
from app.errors import ReportError
from app.metrics.cost import cost_usd
from app.metrics.numbers import main_tokens, mapping, num, overhead_io, total_io
from app.scoring.score import CATEGORIES

TOOLS = ("delegate_task", "execute_code", "skill_view", "terminal")
_RUN = re.compile(r"^r(\d+)$")


@dataclass(frozen=True)
class CellSummary:
    """One matrix cell averaged over its repeats."""

    cell: str
    runs: int
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
    overhead_tokens_mean: float
    cost_mean_usd: float
    category_f1_mean: dict[str, float]


def runs_root(results: Path) -> Path:
    """The folder holding the per-cell run folders."""
    return results / "runs" if (results / "runs").is_dir() else results


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


def _cat_f1(rec: CellRecord, category: str) -> float:
    return num(mapping(mapping(rec.score.get("by_category")).get(category)).get("f1"))


def _summary(cell: str, recs: list[CellRecord]) -> CellSummary:
    f1s = [_f1(r) for r in recs]
    totals = [float(sum(main_tokens(r))) for r in recs]
    walls = [r.wall_seconds for r in recs]
    costs = [cost_usd(*total_io(r)) for r in recs]
    return CellSummary(
        cell=cell,
        runs=len(recs),
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
        learning_paths=tuple(r.learning_path for r in recs),
        skill_loaded_runs=sum(r.skill_loaded for r in recs),
        overhead_tokens_mean=fmean(sum(overhead_io(r)) for r in recs),
        cost_mean_usd=fmean(costs),
        category_f1_mean={c: fmean(_cat_f1(r, c) for r in recs) for c in CATEGORIES},
    )


def summarise(records: list[CellRecord]) -> list[CellSummary]:
    """One summary per cell that has records, in the fixed cell order."""
    return [
        _summary(cell, [r for r in records if r.cell == cell])
        for cell in CELLS
        if any(r.cell == cell for r in records)
    ]
