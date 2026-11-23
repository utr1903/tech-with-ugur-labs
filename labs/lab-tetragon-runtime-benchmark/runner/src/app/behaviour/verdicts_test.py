from __future__ import annotations

from app.behaviour.verdicts import DemoResult, judge, render_behaviour


def _result(
    case: str, *, expected: bool, alerted: bool, outcome_ok: bool = True
) -> DemoResult:
    return DemoResult(
        name="lineage",
        case=case,
        expected_alert=expected,
        alerted=alerted,
        detail="d",
        outcome_ok=outcome_ok,
    )


def test_judge_accepts_matching_results() -> None:
    results = [
        _result("rce", expected=True, alerted=True),
        _result("admin", expected=False, alerted=False),
    ]
    assert judge(results) == ()


def test_judge_flags_missing_alert() -> None:
    failures = judge([_result("rce", expected=True, alerted=False)])
    assert len(failures) == 1
    assert "rce" in failures[0]
    assert "missing" in failures[0]


def test_judge_flags_unexpected_alert() -> None:
    failures = judge([_result("admin", expected=False, alerted=True)])
    assert len(failures) == 1
    assert "unexpected" in failures[0]


def test_judge_flags_wrong_outcome() -> None:
    failures = judge(
        [_result("sigkill", expected=True, alerted=True, outcome_ok=False)]
    )
    assert len(failures) == 1
    assert "outcome" in failures[0]


def test_render_lists_every_case() -> None:
    results = [
        _result("rce", expected=True, alerted=True),
        _result("admin", expected=False, alerted=False),
    ]
    text = render_behaviour(results)
    assert "rce" in text
    assert "admin" in text
    assert "All behaviour cases matched" in text


def test_render_states_failures() -> None:
    text = render_behaviour([_result("rce", expected=True, alerted=False)])
    assert "FAILED" in text


def _lesson(case: str, *, alerted: bool) -> DemoResult:
    return DemoResult(
        name="sigkill-vs-override",
        case=case,
        expected_alert=True,
        alerted=alerted,
        detail="d",
        outcome_ok=True,
    )


def test_lesson_shown_only_when_both_cases_pass() -> None:
    passing = render_behaviour(
        [_lesson("sigkill", alerted=True), _lesson("override", alerted=True)]
    )
    failing = render_behaviour(
        [_lesson("sigkill", alerted=True), _lesson("override", alerted=False)]
    )
    assert "**Lesson:**" in passing
    assert "**Lesson:**" not in failing
