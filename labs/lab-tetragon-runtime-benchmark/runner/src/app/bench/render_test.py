"""Tests for rendering the coverage matrix."""

from __future__ import annotations

import json
from pathlib import Path

from app.bench.model import Profile, Summary
from app.bench.render import render_json, render_markdown
from app.scenarios.model import Scenario


def _scenario(sid: str, *, benign: bool = False) -> Scenario:
    return Scenario(
        id=sid,
        name=f"name {sid}",
        tactic="Execution",
        pod="victim",
        namespace="victim",
        benign=benign,
        expected_tuned="detect",
        expected_enforce="block",
        requires=(),
        signals=(),
        directory=Path(),
    )


def _summary(sid: str, profile: Profile, detected: int, blocked: int = 0) -> Summary:
    return Summary(
        scenario_id=sid,
        profile=profile,
        runs=3,
        detected=detected,
        blocked=blocked,
        median_latency_ms=42.0 if detected else None,
        enforcement_events=blocked,
        side_effect_ok=3 - blocked,
        note=None,
    )


def _fixture() -> tuple[list[Summary], list[Scenario]]:
    scenarios = [
        _scenario("T1059.004"),
        _scenario("T1105"),
        _scenario("B1", benign=True),
    ]
    summaries = [
        _summary("T1059.004", "default", 0),
        _summary("T1059.004", "tuned", 3),
        _summary("T1059.004", "enforce", 3, blocked=3),
        _summary("T1105", "default", 3),
        _summary("T1105", "tuned", 0),
        _summary("T1105", "enforce", 0),
        _summary("B1", "tuned", 1),
        _summary("B1", "enforce", 0),
    ]
    return summaries, scenarios


def test_markdown_has_row_per_scenario_and_recall_lines() -> None:
    summaries, scenarios = _fixture()
    text = render_markdown(
        summaries, scenarios, override_available=True, failures=["T1105 missed"]
    )
    assert "| # | Scenario | Technique | default | tuned | enforce |" in text
    assert "| T1059.004 | name T1059.004 | Execution | missed | detected 3/3 |" in text
    assert "blocked 3/3" in text
    assert "| 42 ms |" in text
    assert "tuned: 1/2 attack scenarios detected" in text
    assert "default: 1/2 attack scenarios detected" in text
    assert "enforce: 1/2 attack scenarios blocked" in text
    assert "B1" in text.split("False positives")[1]
    assert "- T1105 missed" in text


def test_json_roundtrips_counts() -> None:
    summaries, scenarios = _fixture()
    data = json.loads(
        render_json(summaries, scenarios, override_available=False, failures=["x"])
    )
    assert data["override_available"] is False
    assert data["failures"] == ["x"]
    assert len(data["summaries"]) == len(summaries)
    assert data["summaries"][1]["detected"] == 3
