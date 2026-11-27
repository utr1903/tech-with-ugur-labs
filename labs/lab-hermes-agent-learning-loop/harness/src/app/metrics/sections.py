"""The prose sections of metrics.md: misses and what the agent wrote."""

from __future__ import annotations

from pathlib import Path

from app.cells.names import CELLS
from app.cells.record import CellRecord
from app.metrics.aggregate import latest, runs_root
from app.metrics.numbers import mapping


def finding_text(finding: object) -> str:
    """A finding tuple as a short readable string."""
    if isinstance(finding, list | tuple):
        return " / ".join(str(part) for part in finding)
    return str(finding)


def _items(value: object) -> str:
    if not isinstance(value, list) or not value:
        return "none"
    return "; ".join(finding_text(f) for f in value)


def went_wrong(latest_records: list[CellRecord | None]) -> list[str]:
    """Missed and extra findings of each cell's latest repeat."""
    lines = ["## Where it went wrong", ""]
    for rec in latest_records:
        if rec is None:
            continue
        score = mapping(rec.score)
        lines.append(
            f"- **{rec.cell}** ({rec.repeat}): missed {_items(score.get('missed'))}"
            f"; extra {_items(score.get('extra'))}"
        )
    return lines


def _link(label: str, results: Path, target: Path) -> str:
    if not target.is_file():
        return ""
    return f"[{label}]({target.relative_to(results).as_posix()})"


def wrote(records: list[CellRecord], results: Path) -> list[str]:
    """Links to what the agent wrote in the latest cold and warm repeats."""
    lines = ["## What the agent wrote", ""]
    for cell in CELLS:
        rec = latest(records, cell)
        if rec is None or not cell.endswith(("-cold", "-warm")):
            continue
        run_dir = runs_root(results) / cell / rec.repeat
        links = [
            _link(name, results, run_dir / "skills" / name / "SKILL.md")
            for name in rec.agent_created_skills
        ]
        links.append(_link("MEMORY.md", results, run_dir / "MEMORY.md"))
        shown = ", ".join(link for link in links if link) or "nothing copied"
        lines.append(f"- **{cell}** ({rec.repeat}): {shown}")
    return lines
