from __future__ import annotations

from pathlib import Path

import pytest

from app.errors import ReportError
from app.hermes.home import (
    agent_created,
    copy_out,
    list_skills,
    load_baseline,
    parse_frontmatter,
    save_baseline,
    snapshot_path,
)
from app.logging_setup import get_logger

LOG = get_logger()


def _skill(home: Path, rel: str, name: str, description: str = "Use when x.") -> Path:
    path = home / "skills" / rel / "SKILL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n",
        encoding="utf-8",
    )
    return path


def test_list_skills_parses_frontmatter(tmp_path: Path) -> None:
    _skill(tmp_path, "devops/count-and-ips", "count-and-ips", "Use when counting.")
    _skill(tmp_path, "old", "archived", "x")
    (tmp_path / "skills" / ".archive").mkdir()
    (tmp_path / "skills" / "old").rename(tmp_path / "skills" / ".archive" / "old")
    bad = tmp_path / "skills" / "broken" / "SKILL.md"
    bad.parent.mkdir(parents=True)
    bad.write_text("no frontmatter here", encoding="utf-8")

    skills = list_skills(tmp_path, log=LOG)

    assert sorted(skills) == ["broken", "count-and-ips"]
    assert skills["count-and-ips"].description == "Use when counting."
    assert skills["count-and-ips"].path.name == "SKILL.md"
    assert skills["broken"].description == ""


def test_list_skills_without_skills_dir_is_empty(tmp_path: Path) -> None:
    assert list_skills(tmp_path, log=LOG) == {}


def test_missing_description_raises() -> None:
    with pytest.raises(ReportError):
        parse_frontmatter("---\nname: only-a-name\n---\nbody")
    with pytest.raises(ReportError):
        parse_frontmatter("---\ndescription: d\n---\nbody")
    with pytest.raises(ReportError):
        parse_frontmatter("plain text")
    assert parse_frontmatter("---\nname: n\ndescription: d\n---\n") == {
        "name": "n",
        "description": "d",
    }


def test_agent_created_diffs_baseline(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _skill(home, "bundled/one", "one")
    baseline_file = snapshot_path(tmp_path, "home")
    save_baseline(home, baseline_file, log=LOG)
    _skill(home, "mine/two", "two")

    baseline = load_baseline(baseline_file)
    assert baseline == frozenset({"skills/bundled/one/SKILL.md"})
    assert sorted(agent_created(home, baseline, log=LOG)) == ["two"]


def test_copy_out_skill_and_memory(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _skill(home, "mine/two", "two")
    _skill(home, "mine/three", "three")
    (home / "memories").mkdir()
    (home / "memories" / "MEMORY.md").write_text("remember", encoding="utf-8")
    (home / "memories" / "USER.md").write_text("private", encoding="utf-8")
    (home / "auth.json").write_text("secret", encoding="utf-8")
    dest = tmp_path / "out"

    written = copy_out(home, ["two", "three"], dest, log=LOG)

    assert (dest / "skills" / "two" / "SKILL.md").read_text().startswith("---")
    assert (dest / "skills" / "three" / "SKILL.md").exists()
    assert (dest / "MEMORY.md").read_text() == "remember"
    assert len(written) == 3
    assert sorted(p.name for p in dest.rglob("*") if p.is_file()) == [
        "MEMORY.md",
        "SKILL.md",
        "SKILL.md",
    ]


def test_copy_out_without_memory(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _skill(home, "a", "a")
    written = copy_out(home, ["a"], tmp_path / "out", log=LOG)
    assert [p.name for p in written] == ["SKILL.md"]


def test_copy_out_unknown_skill_raises(tmp_path: Path) -> None:
    with pytest.raises(ReportError):
        copy_out(tmp_path, ["ghost"], tmp_path / "out", log=LOG)
