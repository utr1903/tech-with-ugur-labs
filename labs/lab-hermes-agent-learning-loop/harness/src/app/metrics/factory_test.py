"""Builders for run records used by the metrics and assert tests."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.cells.record import CellRecord, write_record
from app.commands.run import CELLS
from app.envvars import Settings

MODEL = "google/gemma-4-26b-a4b-it-maas"


def make_record(cell: str, /, **over: object) -> CellRecord:
    full = cell.startswith("full-")
    tools = (
        {"terminal": 4, "delegate_task": 2, "execute_code": 3}
        if full
        else {"terminal": 6}
    )
    fields: dict[str, Any] = {
        "cell": cell,
        "config": cell.split("-")[0],
        "home": "h",
        "week": "week-1",
        "repeat": "r1",
        "run_id": "run_1",
        "session_id": "run_1",
        "started_at": "2026-11-27T10:00:00+00:00",
        "wall_seconds": 100.0,
        "status": "completed",
        "error": None,
        "score": {
            "f1": 0.9,
            "format_failure": False,
            "by_category": {c: {"f1": 0.9} for c in ("ip", "config", "dep")},
            "missed": [["ip", "svc-a", "10.0.0.1"]],
            "extra": [],
        },
        "parent_tokens": {"input": 1000, "output": 100},
        "children": [{"id": "c1"}] if full else [],
        "children_tokens": {"input": 500, "output": 50}
        if full
        else {"input": 0, "output": 0},
        "tools": tools,
        "parent_tools": tools,
        "children_tools": {},
        "skills_before": [],
        "skills_after": [],
        "skills_deleted": [],
        "agent_created_skills": [],
        "skill_loaded": False,
        "skill_patched": False,
        "learning_path": "n/a",
        "review": {
            "result": "done",
            "calls": 1,
            "input_tokens": 200,
            "output_tokens": 20,
        },
        "review_result": "done",
        "follow_up": None,
        "follow_up_review": None,
        "model": MODEL,
        "hermes_version": "0.23.4",
    }
    merged: dict[str, Any] = {**fields, **over}
    return CellRecord(**merged)


def write_matrix(results: Path, **over: object) -> None:
    """A passing six-cell matrix with one skill written by full-cold."""
    for cell in CELLS:
        extra: dict[str, object] = {}
        if cell == "full-cold":
            extra = {
                "skills_after": ["triage"],
                "agent_created_skills": ["triage"],
                "learning_path": "unprompted",
            }
            skill = results / cell / "r1" / "skills" / "triage" / "SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text("---\nname: triage\ndescription: d\n---\nbody\n")
        if cell == "full-warm":
            extra = {"skill_loaded": True, "skills_before": ["triage"]}
        write_record(results / cell / "r1", make_record(cell, **{**extra, **over}))


def settings_for(tmp: Path) -> Settings:
    return Settings(
        "u", "k" * 16, tmp / "d", tmp / "res", tmp / "o", tmp / "h", tmp / "a"
    )
