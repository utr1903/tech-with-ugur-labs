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

    baseline = load_baseline(baseline_file, log=LOG)
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


def test_traversal_and_absolute_names_fall_back_to_dir_name(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _skill(home, "evil", "../../escape")
    _skill(home, "abs", "/tmp/abs-escape")
    skills = list_skills(home, log=LOG)
    assert sorted(skills) == ["abs", "evil"]
    dest = tmp_path / "deep" / "out"
    copy_out(home, ["evil", "abs"], dest, log=LOG)
    assert (dest / "skills" / "evil" / "SKILL.md").exists()
    assert not (tmp_path / "escape").exists()


def test_copy_out_refuses_unknown_traversal_name(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _skill(home, "ok", "ok")
    with pytest.raises(ReportError):
        copy_out(home, ["../x"], tmp_path / "out", log=LOG)


def test_symlinked_skill_file_is_skipped(tmp_path: Path) -> None:
    home = tmp_path / "home"
    secret = tmp_path / "auth.json"
    secret.write_text("---\nname: s\ndescription: d\n---\nsecret", "utf-8")
    link = home / "skills" / "leak" / "SKILL.md"
    link.parent.mkdir(parents=True)
    link.symlink_to(secret)
    assert list_skills(home, log=LOG) == {}


def test_symlinked_skill_dir_is_skipped(tmp_path: Path) -> None:
    home = tmp_path / "home"
    outside = tmp_path / "elsewhere"
    _skill(outside, "x", "x")
    (home / "skills").mkdir(parents=True)
    (home / "skills" / "linked").symlink_to(outside / "skills" / "x")
    assert list_skills(home, log=LOG) == {}


def test_symlinked_memory_is_not_copied(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _skill(home, "a", "a")
    (home / "memories").mkdir()
    secret = tmp_path / "transcript.txt"
    secret.write_text("secret", encoding="utf-8")
    (home / "memories" / "MEMORY.md").symlink_to(secret)
    written = copy_out(home, ["a"], tmp_path / "out", log=LOG)
    assert [p.name for p in written] == ["SKILL.md"]
    assert not (tmp_path / "out" / "MEMORY.md").exists()


def test_duplicate_names_are_keyed_by_directory(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _skill(home, "alpha/dup", "dup")
    _skill(home, "beta/dup", "dup")
    skills = list_skills(home, log=LOG)
    assert sorted(skills) == ["beta/dup", "dup"]
    assert "alpha" in str(skills["dup"].path)
    assert "beta" in str(skills["beta/dup"].path)
    dest = tmp_path / "out"
    copy_out(home, ["dup", "beta/dup"], dest, log=LOG)
    assert (dest / "skills" / "beta" / "dup" / "SKILL.md").exists()


def test_pending_dir_is_skipped(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _skill(home, "pending/p", "p")
    _skill(home, "real", "real")
    assert sorted(list_skills(home, log=LOG)) == ["real"]


def test_bom_frontmatter_is_read(tmp_path: Path) -> None:
    home = tmp_path / "home"
    path = _skill(home, "bom", "bom", "Use when bom.")
    path.write_bytes(b"\xef\xbb\xbf" + path.read_bytes())
    assert list_skills(home, log=LOG)["bom"].description == "Use when bom."


def test_load_baseline_errors_are_report_errors(tmp_path: Path) -> None:
    bad = tmp_path / "b.json"
    bad.write_text("{", encoding="utf-8")
    with pytest.raises(ReportError):
        load_baseline(bad, log=LOG)
    with pytest.raises(ReportError):
        load_baseline(tmp_path / "missing.json", log=LOG)
