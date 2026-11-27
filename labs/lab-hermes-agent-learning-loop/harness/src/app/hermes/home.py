"""Reads what the agent left in its Hermes home: skills, memory, baseline."""

from __future__ import annotations

import json
import shutil
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import yaml

from app.errors import ReportError
from app.logging_setup import Logger

_SKILLS = "skills"
_ARCHIVE = ".archive"
_SKIPPED_DIRS = frozenset({_ARCHIVE, "pending"})
_MEMORY = Path("memories") / "MEMORY.md"


@dataclass(frozen=True)
class SkillFile:
    """One `SKILL.md` found in the Hermes home."""

    name: str
    path: Path
    description: str


def parse_frontmatter(text: str) -> dict[str, object]:
    """Parses the leading `---` YAML block; `name` and `description` required."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ReportError("SKILL.md has no leading '---' frontmatter")
    try:
        end = next(i for i, ln in enumerate(lines[1:], 1) if ln.strip() == "---")
    except StopIteration:
        raise ReportError("SKILL.md frontmatter is not closed") from None
    try:
        data = yaml.safe_load("\n".join(lines[1:end]))
    except yaml.YAMLError as err:
        raise ReportError(f"SKILL.md frontmatter is not valid YAML: {err}") from err
    if not isinstance(data, dict):
        raise ReportError("SKILL.md frontmatter is not a mapping")
    for key in ("name", "description"):
        if not isinstance(data.get(key), str) or not data[key]:
            raise ReportError(f"SKILL.md frontmatter is missing '{key}'")
    return {str(k): v for k, v in data.items()}


def _skill_paths(home: Path) -> list[Path]:
    root = home / _SKILLS
    if not root.is_dir():
        return []
    return sorted(
        p
        for p in root.rglob("SKILL.md")
        if not _SKIPPED_DIRS.intersection(p.relative_to(root).parts)
    )


def _read_skill(path: Path, *, log: Logger) -> SkillFile:
    try:
        meta = parse_frontmatter(path.read_text(encoding="utf-8"))
    except ReportError:
        log.warning("Skill frontmatter is invalid.", path=str(path))
        return SkillFile(name=path.parent.name, path=path, description="")
    return SkillFile(
        name=str(meta["name"]), path=path, description=str(meta["description"])
    )


def list_skills(home: Path, *, log: Logger) -> dict[str, SkillFile]:
    """Every skill in `home`, archived ones excluded, keyed by skill name."""
    try:
        log.info("Listing skills...", home=str(home))
        skills = {}
        for path in _skill_paths(home):
            skill = _read_skill(path, log=log)
            skills[skill.name] = skill
    except Exception:
        log.exception("Listing skills failed.", home=str(home))
        raise
    else:
        log.info("Listing skills succeeded.", skills=len(skills))
        return skills


def snapshot_path(results: Path, home_name: str) -> Path:
    """Where the baseline of `home_name` is stored under `results`."""
    return results / f"{home_name}-baseline.json"


def _relative_skill_paths(home: Path) -> list[str]:
    return sorted(p.relative_to(home).as_posix() for p in _skill_paths(home))


def save_baseline(home: Path, dest: Path, *, log: Logger) -> None:
    """Records which skill files exist now (bundled ones included)."""
    try:
        log.info("Saving skill baseline...", home=str(home), dest=str(dest))
        paths = _relative_skill_paths(home)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(paths, indent=2) + "\n", encoding="utf-8")
    except Exception:
        log.exception("Saving skill baseline failed.", home=str(home))
        raise
    else:
        log.info("Saving skill baseline succeeded.", skills=len(paths))


def load_baseline(dest: Path) -> frozenset[str]:
    """Reads the skill paths stored by `save_baseline`."""
    try:
        data = json.loads(dest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        raise ReportError(f"Cannot read baseline {dest}: {err}") from err
    if not isinstance(data, list) or not all(isinstance(x, str) for x in data):
        raise ReportError(f"Baseline {dest} is not a list of paths")
    return frozenset(data)


def agent_created(
    home: Path, baseline: frozenset[str], *, log: Logger
) -> dict[str, SkillFile]:
    """Skills whose file was not in the baseline: the agent wrote them."""
    skills = list_skills(home, log=log)
    return {
        name: skill
        for name, skill in skills.items()
        if skill.path.relative_to(home).as_posix() not in baseline
    }


def copy_out(
    home: Path, names: Iterable[str], dest: Path, *, log: Logger
) -> list[Path]:
    """Copies the named skills' `SKILL.md` and `MEMORY.md`; nothing else."""
    wanted = list(names)
    skills = list_skills(home, log=log)
    missing = [n for n in wanted if n not in skills]
    if missing:
        raise ReportError(f"Skills not found in {home}: {', '.join(missing)}")

    try:
        log.info("Copying out skills...", skills=wanted, dest=str(dest))
        written: list[Path] = []
        for name in wanted:
            target = dest / _SKILLS / name / "SKILL.md"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(skills[name].path, target)
            written.append(target)
        memory = home / _MEMORY
        if memory.is_file():
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(memory, dest / "MEMORY.md")
            written.append(dest / "MEMORY.md")
    except Exception:
        log.exception("Copying out skills failed.", dest=str(dest))
        raise
    else:
        log.info("Copying out skills succeeded.", files=len(written))
        return written
