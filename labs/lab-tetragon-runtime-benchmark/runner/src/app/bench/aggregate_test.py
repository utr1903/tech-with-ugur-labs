"""Tests for summarising runs and evaluating expectations."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from app.bench.aggregate import evaluate, summarize
from app.bench.model import Profile, RunResult
from app.scenarios.model import Scenario


def _scenario(
    *,
    benign: bool = False,
    requires: tuple[str, ...] = (),
    expected_enforce: Literal["block", "detect", "none"] = "block",
    sid: str = "T1",
) -> Scenario:
    return Scenario(
        id=sid,
        technique="T1",
        name="n",
        tactic="t",
        pod="victim",
        namespace="victim",
        benign=benign,
        expected_tuned="detect",
        expected_enforce=expected_enforce,
        requires=requires,
        signals=(),
        directory=Path(),
    )


def _run(
    profile: Profile,
    index: int = 0,
    *,
    detected: bool = True,
    latency: float | None = 100,
    enforced: bool = False,
    side_effect: bool = True,
    sid: str = "T1",
) -> RunResult:
    return RunResult(
        scenario_id=sid,
        profile=profile,
        run_index=index,
        detected=detected,
        latency_ms=latency if detected else None,
        enforcement_seen=enforced,
        side_effect=side_effect,
    )


def test_tuned_never_counts_blocked() -> None:
    runs = [_run("tuned", i, enforced=True, side_effect=False) for i in range(3)]
    (s,) = summarize(runs, override_available=True, scenarios=[_scenario()])
    assert s.blocked == 0
    assert s.detected == 3


def test_enforce_blocked_requires_no_side_effect() -> None:
    runs = [
        _run("enforce", 0, enforced=True, side_effect=False),
        _run("enforce", 1, enforced=True, side_effect=True),
        _run("enforce", 2, enforced=False, side_effect=False),
    ]
    (s,) = summarize(runs, override_available=True, scenarios=[_scenario()])
    assert s.blocked == 1
    assert s.enforcement_events == 2
    assert s.side_effect_ok == 1


def test_median_latency() -> None:
    runs = [_run("tuned", i, latency=v) for i, v in enumerate((10, 30, 20))]
    (s,) = summarize(runs, override_available=True, scenarios=[_scenario()])
    assert s.median_latency_ms == 20


def test_sigkill_only_note_skips_block_assertion() -> None:
    scenario = _scenario(requires=("override",))
    runs = [_run("enforce", i, enforced=False, side_effect=True) for i in range(3)]
    runs += [_run("tuned", i) for i in range(3)]
    summaries = summarize(runs, override_available=False, scenarios=[scenario])
    assert all(s.note == "Sigkill only (Override unavailable)" for s in summaries)
    assert evaluate(summaries, [scenario]) == ()


def test_two_of_three_detect_passes_one_of_three_fails() -> None:
    scenario = _scenario()
    two = [_run("tuned", i, detected=i < 2) for i in range(3)]
    one = [_run("tuned", i, detected=i < 1) for i in range(3)]
    ok = summarize(two, override_available=True, scenarios=[scenario])
    bad = summarize(one, override_available=True, scenarios=[scenario])
    assert evaluate(ok, [scenario]) == ()
    assert len(evaluate(bad, [scenario])) == 1


def test_benign_enforcement_fails() -> None:
    scenario = _scenario(benign=True, sid="B1")
    runs = [
        _run("enforce", i, sid="B1", enforced=(i == 0), side_effect=True)
        for i in range(3)
    ]
    summaries = summarize(runs, override_available=True, scenarios=[scenario])
    assert len(evaluate(summaries, [scenario])) == 1


def test_benign_tuned_detection_is_not_a_failure() -> None:
    scenario = _scenario(benign=True, sid="B1")
    runs = [_run("tuned", i, sid="B1") for i in range(3)]
    summaries = summarize(runs, override_available=True, scenarios=[scenario])
    assert evaluate(summaries, [scenario]) == ()


def test_default_zero_recall_fails() -> None:
    scenario = _scenario()
    runs = [_run("default", i, detected=False) for i in range(3)]
    summaries = summarize(runs, override_available=True, scenarios=[scenario])
    assert len(evaluate(summaries, [scenario])) == 1


def test_attack_side_effect_missing_without_enforcement_fails() -> None:
    scenario = _scenario()
    runs = [_run("default", i, side_effect=i < 1) for i in range(3)]
    runs += [_run("tuned", i, side_effect=False) for i in range(3)]
    summaries = summarize(runs, override_available=True, scenarios=[scenario])
    failures = evaluate(summaries, [scenario])
    assert len(failures) == 2
    assert all("check.sh is broken" in f for f in failures)


def test_attack_side_effect_seen_in_two_of_three_passes() -> None:
    scenario = _scenario()
    runs = [_run("default", i, side_effect=i < 2) for i in range(3)]
    runs += [_run("tuned", i, side_effect=i < 2) for i in range(3)]
    summaries = summarize(runs, override_available=True, scenarios=[scenario])
    assert evaluate(summaries, [scenario]) == ()
