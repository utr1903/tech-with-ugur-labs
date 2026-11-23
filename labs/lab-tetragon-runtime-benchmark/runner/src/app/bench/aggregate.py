"""Aggregates runs into summaries and checks them against expectations."""

from __future__ import annotations

import math
import statistics
from collections.abc import Sequence

from app.bench.model import RunResult, Summary
from app.scenarios.model import Scenario

SIGKILL_ONLY_NOTE = "Sigkill only (Override unavailable)"


def threshold(runs: int) -> int:
    """Detections (or blocks) needed to pass: two thirds, rounded up."""
    return math.ceil(2 * runs / 3)


def summarize(
    results: Sequence[RunResult],
    *,
    override_available: bool,
    scenarios: Sequence[Scenario],
) -> tuple[Summary, ...]:
    """One summary per scenario and profile that has at least one run."""
    summaries: list[Summary] = []
    for scenario in scenarios:
        note = (
            SIGKILL_ONLY_NOTE
            if "override" in scenario.requires and not override_available
            else None
        )
        for profile in ("default", "tuned", "enforce"):
            runs = [
                r
                for r in results
                if r.scenario_id == scenario.id and r.profile == profile
            ]
            if runs:
                summaries.append(_summarize(runs, scenario, note))
    return tuple(summaries)


def _summarize(runs: list[RunResult], scenario: Scenario, note: str | None) -> Summary:
    latencies = [r.latency_ms for r in runs if r.detected and r.latency_ms is not None]
    enforce = runs[0].profile == "enforce"
    return Summary(
        scenario_id=scenario.id,
        profile=runs[0].profile,
        runs=len(runs),
        detected=sum(r.detected for r in runs),
        blocked=sum(r.enforcement_seen and not r.side_effect for r in runs)
        if enforce
        else 0,
        median_latency_ms=statistics.median(latencies) if latencies else None,
        enforcement_events=sum(r.enforcement_seen for r in runs),
        side_effect_ok=sum(r.side_effect for r in runs),
        note=note,
    )


def evaluate(
    summaries: Sequence[Summary], scenarios: Sequence[Scenario]
) -> tuple[str, ...]:
    """Human-readable expectation failures; empty when the bench passes."""
    by_id = {s.id: s for s in scenarios}
    failures = [
        *_default_failures(summaries, by_id),
        *(
            failure
            for summary in summaries
            if summary.scenario_id in by_id
            for failure in _scenario_failures(summary, by_id[summary.scenario_id])
        ),
    ]
    return tuple(failures)


def _default_failures(
    summaries: Sequence[Summary], by_id: dict[str, Scenario]
) -> list[str]:
    attack = [
        s
        for s in summaries
        if s.profile == "default" and not by_id[s.scenario_id].benign
    ]
    if attack and sum(s.detected for s in attack) == 0:
        return ["default: no attack scenario was detected in any run"]
    return []


def _scenario_failures(summary: Summary, scenario: Scenario) -> list[str]:
    need = threshold(summary.runs)
    label = f"{scenario.id} ({scenario.name}) {summary.profile}"
    if scenario.benign:
        return _benign_failures(summary, label)
    failures = _control_failures(summary, label, need)
    if summary.profile == "default":
        return failures
    expects_detect = (
        scenario.expected_tuned == "detect"
        if summary.profile == "tuned"
        else scenario.expected_enforce == "detect"
    )
    if expects_detect and summary.detected < need:
        failures.append(
            f"{label}: detected {summary.detected}/{summary.runs}, need {need}"
        )
    expects_block = (
        summary.profile == "enforce" and scenario.expected_enforce == "block"
    )
    if expects_block and summary.note is None and summary.blocked < need:
        failures.append(
            f"{label}: blocked {summary.blocked}/{summary.runs}, need {need}"
        )
    return failures


def _control_failures(summary: Summary, label: str, need: int) -> list[str]:
    """Without enforcement the side effect must happen, or check.sh is untrustworthy."""
    if summary.profile == "enforce" or summary.side_effect_ok >= need:
        return []
    return [
        f"{label}: side effect seen in {summary.side_effect_ok}/{summary.runs} "
        f"runs without enforcement, need {need}; the attack or check.sh is broken"
    ]


def _benign_failures(summary: Summary, label: str) -> list[str]:
    if summary.profile != "enforce":
        return []
    failures: list[str] = []
    if summary.enforcement_events > 0:
        failures.append(
            f"{label}: benign workload hit enforcement in "
            f"{summary.enforcement_events}/{summary.runs} runs"
        )
    if summary.side_effect_ok < summary.runs:
        failures.append(
            f"{label}: benign side effect happened in "
            f"{summary.side_effect_ok}/{summary.runs} runs"
        )
    return failures
