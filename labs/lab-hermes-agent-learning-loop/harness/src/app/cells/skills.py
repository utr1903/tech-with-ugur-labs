"""Which agent-made skills a run loaded, changed or lost."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.hermes.home import agent_created
from app.logging_setup import Logger

PATCH_ACTIONS = frozenset({"patch", "edit", "update"})


@dataclass(frozen=True)
class SkillChanges:
    """How a run touched the skills that existed before it."""

    loaded: bool
    patched: bool
    deleted: list[str]


def skill_texts(home: Path, baseline: frozenset[str], *, log: Logger) -> dict[str, str]:
    """SKILL.md text of every agent-created skill, by name."""
    return {
        name: skill.path.read_text(encoding="utf-8")
        for name, skill in agent_created(home, baseline, log=log).items()
    }


def skill_changes(
    before: dict[str, str],
    after: dict[str, str],
    calls: list[tuple[str, str, str]],
) -> SkillChanges:
    """Loaded/patched/deleted, judged only on skills that pre-existed."""
    loaded = any(tool == "skill_view" and name in before for tool, name, _ in calls)
    called = any(
        tool == "skill_manage" and action in PATCH_ACTIONS and name in before
        for tool, name, action in calls
    )
    changed = any(after[n] != text for n, text in before.items() if n in after)
    return SkillChanges(loaded, called or changed, sorted(set(before) - set(after)))
