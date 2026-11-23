"""Renders the coverage matrix as Markdown or JSON."""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict

from app.bench.aggregate import threshold
from app.bench.model import Profile, Summary
from app.scenarios.model import Scenario

_PROFILES: tuple[Profile, ...] = ("default", "tuned", "enforce")


def _find(
    summaries: Sequence[Summary], scenario_id: str, profile: Profile
) -> Summary | None:
    return next(
        (s for s in summaries if s.scenario_id == scenario_id and s.profile == profile),
        None,
    )


def _cell(summary: Summary | None) -> str:
    if summary is None:
        return "-"
    if summary.profile == "enforce" and summary.blocked > 0:
        text = f"blocked {summary.blocked}/{summary.runs}"
    elif summary.detected > 0:
        text = f"detected {summary.detected}/{summary.runs}"
    else:
        text = "missed"
    return f"{text} ({summary.note})" if summary.note else text


def _latency(summary: Summary | None) -> str:
    if summary is None or summary.median_latency_ms is None:
        return "-"
    return f"{summary.median_latency_ms:.0f} ms"


def _passed(summary: Summary | None, profile: Profile) -> bool:
    if summary is None:
        return False
    count = summary.blocked if profile == "enforce" else summary.detected
    return count >= threshold(summary.runs)


def _recall_line(
    summaries: Sequence[Summary], attack: Sequence[Scenario], profile: Profile
) -> str:
    hit = sum(_passed(_find(summaries, s.id, profile), profile) for s in attack)
    verb = "blocked" if profile == "enforce" else "detected"
    return f"- {profile}: {hit}/{len(attack)} attack scenarios {verb}"


def _false_positives(
    summaries: Sequence[Summary], benign: Sequence[Scenario]
) -> list[str]:
    lines = []
    for scenario in benign:
        for profile in ("tuned", "enforce"):
            summary = _find(summaries, scenario.id, profile)
            if summary is not None and summary.detected > 0:
                lines.append(
                    f"- {scenario.id} ({scenario.name}) under {profile}: "
                    f"{summary.detected}/{summary.runs} runs flagged"
                )
    return lines or ["- none"]


def render_markdown(
    summaries: Sequence[Summary],
    scenarios: Sequence[Scenario],
    *,
    override_available: bool,
    failures: Sequence[str],
) -> str:
    """The coverage matrix, false positives, recall and failures."""
    attack = [s for s in scenarios if not s.benign]
    benign = [s for s in scenarios if s.benign]
    lines = [
        "| ATT&CK | Scenario | Tactic | default | tuned | enforce "
        "| median latency (tuned) |",
        "|---|---|---|---|---|---|---|",
    ]
    for s in attack:
        found = [_find(summaries, s.id, p) for p in _PROFILES]
        cells = " | ".join(_cell(f) for f in found)
        lines.append(
            f"| {s.id} | {s.name} | {s.tactic} | {cells} | {_latency(found[1])} |"
        )
    lines += ["", "## False positives (benign scenarios)", ""]
    lines += _false_positives(summaries, benign)
    lines += ["", "## Recall", ""]
    lines += [_recall_line(summaries, attack, p) for p in _PROFILES]
    if not override_available:
        lines += ["", "Override is unavailable on this kernel; Sigkill is used."]
    lines += ["", "## Failures", ""]
    lines += [f"- {f}" for f in failures] or ["- none"]
    return "\n".join(lines) + "\n"


def render_json(
    summaries: Sequence[Summary],
    scenarios: Sequence[Scenario],
    *,
    override_available: bool,
    failures: Sequence[str],
) -> str:
    """Machine-readable form of the same results."""
    del scenarios
    return json.dumps(
        {
            "override_available": override_available,
            "summaries": [asdict(s) for s in summaries],
            "failures": list(failures),
        },
        indent=2,
    )
