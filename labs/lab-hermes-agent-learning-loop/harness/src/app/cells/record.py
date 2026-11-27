"""The per-cell result record (`run.json`) and its run directory."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

_RUN_DIR = re.compile(r"^r(\d+)$")


@dataclass(frozen=True)
class CellRecord:
    """Everything measured for one matrix cell run."""

    cell: str
    config: str
    home: str
    week: str
    repeat: str
    run_id: str
    session_id: str
    started_at: str
    wall_seconds: float
    status: str
    error: str | None
    score: dict[str, object]
    parent_tokens: dict[str, int]
    children: list[dict[str, object]]
    children_tokens: dict[str, int]
    tools: dict[str, int]
    parent_tools: dict[str, int]
    children_tools: dict[str, int]
    skills_before: list[str]
    skills_after: list[str]
    agent_created_skills: list[str]
    skill_loaded: bool
    skill_patched: bool
    learning_path: str
    review: dict[str, object] | None
    review_result: str
    follow_up: dict[str, object] | None
    follow_up_review: dict[str, object] | None
    model: str
    hermes_version: str


def next_run_dir(cell_dir: Path) -> Path:
    """The first free `rN` folder under `cell_dir` (not created)."""
    taken = [
        int(m[1])
        for p in (cell_dir.iterdir() if cell_dir.is_dir() else [])
        if (m := _RUN_DIR.match(p.name))
    ]
    return cell_dir / f"r{max(taken, default=0) + 1}"


def write_record(directory: Path, record: CellRecord) -> Path:
    """Writes `run.json` into `directory` and returns its path."""
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "run.json"
    path.write_text(
        json.dumps(asdict(record), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return path
