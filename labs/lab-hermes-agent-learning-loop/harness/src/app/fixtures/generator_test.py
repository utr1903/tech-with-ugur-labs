from __future__ import annotations

import json
from pathlib import Path, PurePosixPath

import pytest

from app.fixtures.generator import SERVICES, WEEKS, generate_week
from app.fixtures.plan import plan_week
from app.fixtures.rules import answers_for_week


def _materialize(root: Path, week: str) -> Path:
    week_dir = root / week
    for relative, content in generate_week(week).items():
        target = week_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return week_dir


def test_generate_week_deterministic() -> None:
    for week in WEEKS:
        assert generate_week(week) == generate_week(week)


def test_weeks_differ_but_same_services() -> None:
    first, second = generate_week("week-1"), generate_week("week-2")

    for service in SERVICES:
        for name in ("access.log", "config.yaml", "requirements.lock"):
            path = PurePosixPath("services") / service / name
            assert path in first
            assert path in second
    assert first != second
    assert (
        first[PurePosixPath("services/billing/access.log")]
        != second[PurePosixPath("services/billing/access.log")]
    )
    assert PurePosixPath("RUNBOOK.md") in first
    assert first[PurePosixPath("RUNBOOK.md")] == second[PurePosixPath("RUNBOOK.md")]


def test_advisory_counts_grow_by_one() -> None:
    counts = [
        len(
            json.loads(generate_week(week)[PurePosixPath("advisories.json")])[
                "advisories"
            ]
        )
        for week in WEEKS
    ]

    assert counts == [6, 7]


@pytest.mark.parametrize("week", list(WEEKS))
def test_planted_totals_in_range(week: str) -> None:
    plan = plan_week(week)

    assert 6 <= sum(len(s.suspicious_ips) for s in plan.services) <= 12
    assert 4 <= sum(len(s.flags) for s in plan.services) <= 8
    assert 4 <= sum(len(s.vulnerable) for s in plan.services) <= 8
    assert any(not s.flags for s in plan.services)
    for service in plan.services:
        assert len(service.brute_ips) <= 2
        assert len(service.probe_ips) <= 1
        assert 6 <= len(service.packages) <= 10
        assert 1500 <= service.log_lines <= 2500


def test_week_two_changes_flags_and_versions() -> None:
    first, second = plan_week("week-1"), plan_week("week-2")

    flipped = sum(
        len(set(a.flags) ^ set(b.flags))
        for a, b in zip(first.services, second.services, strict=True)
    )
    bumped = sum(
        len(set(a.packages) ^ set(b.packages)) // 2
        for a, b in zip(first.services, second.services, strict=True)
    )
    assert flipped >= 2
    assert bumped >= 2


@pytest.mark.parametrize("week", list(WEEKS))
def test_answers_match_rules_on_disk(tmp_path: Path, week: str) -> None:
    week_dir = _materialize(tmp_path, week)

    assert answers_for_week(week_dir) == plan_week(week).answer()


@pytest.mark.parametrize("week", list(WEEKS))
def test_generated_tree_is_complete(week: str) -> None:
    files = generate_week(week)

    expected = {PurePosixPath("RUNBOOK.md"), PurePosixPath("advisories.json")}
    for service in SERVICES:
        base = PurePosixPath("services") / service
        expected |= {
            base / "access.log",
            base / "config.yaml",
            base / "requirements.lock",
        }
    assert set(files) == expected
    assert all(content for content in files.values())
