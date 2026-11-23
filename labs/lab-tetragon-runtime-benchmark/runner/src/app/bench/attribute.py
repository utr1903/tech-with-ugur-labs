"""Decides what a run's events say about a scenario."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta

from app.bench.model import Attribution
from app.events.match import matches
from app.events.model import Event
from app.scenarios.model import Scenario

ENFORCEMENT_ACTIONS = frozenset({"KPROBE_ACTION_SIGKILL", "KPROBE_ACTION_OVERRIDE"})


def attribute(
    events: Sequence[Event],
    scenario: Scenario,
    *,
    marker: datetime,
    window_s: float,
) -> Attribution:
    """Scores events in [marker, marker + window] from the scenario's pod."""
    end = marker + timedelta(seconds=window_s)
    hits = sorted(
        (
            event
            for event in events
            if event.pod == scenario.pod
            and event.namespace == scenario.namespace
            and marker <= event.time <= end
            and any(matches(event, signal) for signal in scenario.signals)
        ),
        key=lambda event: event.time,
    )
    if not hits:
        return Attribution(detected=False, latency_ms=None, enforcement_seen=False)
    return Attribution(
        detected=True,
        latency_ms=(hits[0].time - marker).total_seconds() * 1000,
        enforcement_seen=any(
            event.kind == "kprobe" and event.action in ENFORCEMENT_ACTIONS
            for event in hits
        ),
    )
