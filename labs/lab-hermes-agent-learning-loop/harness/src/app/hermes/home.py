"""Reads what the agent left in its Hermes home: skills, memory, baseline."""

from __future__ import annotations

import json
import os
import re
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
# Names come from agent-written files, so they must be plain path segments.
_SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


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


def _is_safe_path(home: Path, path: Path, *, log: Logger) -> bool:
    """False if any component below `home` is a symlink or the target escapes."""
    current = home
    for part in path.relative_to(home).parts:
        current = current / part
        if current.is_symlink():
            log.warning("Skipping symlinked path.", path=str(path))
            return False
    if not path.resolve().is_relative_to(home.resolve()):
        log.warning("Skipping path outside the home.", path=str(path))
        return False
    return True


def _skill_paths(home: Path, *, log: Logger) -> list[Path]:
    root = home / _SKILLS
    if not root.is_dir():
        return []
    found: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        here = Path(dirpath)
        dirnames[:] = sorted(
            d
            for d in dirnames
            if d not in _SKIPPED_DIRS and _is_safe_path(home, here / d, log=log)
        )
        skill = here / "SKILL.md"
        if "SKILL.md" in filenames and _is_safe_path(home, skill, log=log):
            found.append(skill)
    return sorted(found)


def _read_skill(path: Path, *, log: Logger) -> SkillFile | None:
    try:
        meta = parse_frontmatter(path.read_text(encoding="utf-8-sig"))
    except ReportError:
        log.warning("Skill frontmatter is invalid.", path=str(path))
        meta = {}
    name = str(meta.get("name", ""))
    description = str(meta.get("description", ""))
    if not _SAFE_NAME.match(name):
        if meta:
            log.warning("Skill name is not a safe path segment.", path=str(path))
        name = path.parent.name
    if not _SAFE_NAME.match(name):
        log.warning("Skipping skill with an unusable name.", path=str(path))
        return None
    return SkillFile(name=name, path=path, description=description)


def _unique_key(home: Path, skill: SkillFile, *, log: Logger) -> str | None:
    """The category-qualified key used when two skills share a name."""
    parts = skill.path.parent.relative_to(home / _SKILLS).parts
    if not parts or not all(_SAFE_NAME.match(p) for p in parts):
        log.warning("Skipping skill with an unusable path.", path=str(skill.path))
        return None
    return "/".join(parts)


def list_skills(home: Path, *, log: Logger) -> dict[str, SkillFile]:
    """Every skill in `home`, archived ones excluded, keyed by skill name."""
    try:
        log.info("Listing skills...", home=str(home))
        skills: dict[str, SkillFile] = {}
        for path in _skill_paths(home, log=log):
            skill = _read_skill(path, log=log)
            if skill is None:
                continue
            if skill.name in skills:
                log.warning("Duplicate skill name.", name=skill.name, path=str(path))
                key = _unique_key(home, skill, log=log)
                if key is None or key in skills:
                    continue
                skill = SkillFile(key, skill.path, skill.description)
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


def _relative_skill_paths(home: Path, *, log: Logger) -> list[str]:
    return sorted(p.relative_to(home).as_posix() for p in _skill_paths(home, log=log))


def save_baseline(home: Path, dest: Path, *, log: Logger) -> None:
    """Records which skill files exist now (bundled ones included)."""
    try:
        log.info("Saving skill baseline...", home=str(home), dest=str(dest))
        paths = _relative_skill_paths(home, log=log)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(paths, indent=2) + "\n", encoding="utf-8")
    except Exception:
        log.exception("Saving skill baseline failed.", home=str(home))
        raise
    else:
        log.info("Saving skill baseline succeeded.", skills=len(paths))


def _read_baseline(dest: Path) -> list[str]:
    data = json.loads(dest.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not all(isinstance(x, str) for x in data):
        raise ReportError(f"Baseline {dest} is not a list of paths")
    return data


def load_baseline(dest: Path, *, log: Logger) -> frozenset[str]:
    """Reads the skill paths stored by `save_baseline`."""
    try:
        log.info("Loading skill baseline...", dest=str(dest))
        data = _read_baseline(dest)
    except (OSError, json.JSONDecodeError, ReportError) as err:
        log.exception("Loading skill baseline failed.", dest=str(dest))
        if isinstance(err, ReportError):
            raise
        raise ReportError(f"Cannot read baseline {dest}: {err}") from err
    else:
        log.info("Loading skill baseline succeeded.", skills=len(data))
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


def _inside(dest: Path, target: Path) -> bool:
    return target.resolve().is_relative_to(dest.resolve())


def _skill_target(dest: Path, name: str) -> Path:
    target = dest / _SKILLS / name / "SKILL.md"
    if not _inside(dest, target):
        raise ReportError(f"Skill target escapes {dest}: {name}")
    return target


def copy_out(
    home: Path, names: Iterable[str], dest: Path, *, log: Logger
) -> list[Path]:
    """Copies the named skills' `SKILL.md` and `MEMORY.md`; nothing else."""
    wanted = list(names)
    skills = list_skills(home, log=log)
    missing = [n for n in wanted if n not in skills]
    if missing:
        log.error("Copying out skills failed.", missing=missing, home=str(home))
        raise ReportError(f"Skills not found in {home}: {', '.join(missing)}")

    try:
        log.info("Copying out skills...", skills=wanted, dest=str(dest))
        written: list[Path] = []
        for name in wanted:
            target = _skill_target(dest, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(skills[name].path, target)
            written.append(target)
        memory = home / _MEMORY
        if memory.is_file() and _is_safe_path(home, memory, log=log):
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(memory, dest / "MEMORY.md")
            written.append(dest / "MEMORY.md")
    except Exception:
        log.exception("Copying out skills failed.", dest=str(dest))
        raise
    else:
        log.info("Copying out skills succeeded.", files=len(written))
        return written
