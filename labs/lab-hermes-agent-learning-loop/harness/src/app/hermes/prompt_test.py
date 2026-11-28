from __future__ import annotations

from app.hermes.prompt import FOLLOW_UP, TODAY, triage_prompt


def test_prompt_pins_date_and_paths() -> None:
    text = triage_prompt("week-02", "cell-a")
    assert TODAY in text
    assert "/fleet/week-02" in text
    assert "/fleet/week-02/RUNBOOK.md" in text
    assert "/out/cell-a/report.json" in text
    assert "If you have delegate_task, give each service to its own subagent:" in text
    assert "tasks set to a list of objects, one per service" in text
    assert 'each with a "goal" and a "context" string' in text
    assert "If you have execute_code, do counting and matching in code" in text


def test_prompt_has_no_skill_word() -> None:
    assert "skill" not in triage_prompt("week-01", "c").lower()


def test_follow_up_asks_for_a_skill() -> None:
    assert "skill" in FOLLOW_UP
