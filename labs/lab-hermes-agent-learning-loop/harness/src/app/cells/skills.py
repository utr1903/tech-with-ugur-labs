"""Which agent-made skills a run loaded or changed."""

from __future__ import annotations

from pathlib import Path

from app.hermes.home import agent_created
from app.logging_setup import Logger

PATCH_ACTIONS = frozenset({"patch", "edit", "update"})


def skill_texts(home: Path, baseline: frozenset[str], *, log: Logger) -> dict[str, str]:
    """SKILL.md text of every agent-created skill, by name."""
    return {
        name: skill.path.read_text(encoding="utf-8")
        for name, skill in agent_created(home, baseline, log=log).items()
    }


def loaded_and_patched(
    before: dict[str, str],
    after: dict[str, str],
    calls: list[tuple[str, str, str]],
) -> tuple[bool, bool]:
    """(skill_loaded, skill_patched) relative to the skills that pre-existed."""
    loaded = any(tool == "skill_view" and name in before for tool, name, _ in calls)
    called = any(
        tool == "skill_manage" and action in PATCH_ACTIONS and name in before
        for tool, name, action in calls
    )
    changed = any(after.get(name) != text for name, text in before.items())
    return loaded, called or changed
