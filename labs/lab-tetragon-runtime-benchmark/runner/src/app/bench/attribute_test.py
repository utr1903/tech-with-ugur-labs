"""Tests for attributing events to a scenario run window."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.bench.attribute import attribute
from app.events.model import Event
from app.scenarios.model import Matcher, Scenario

MARKER = datetime(2026, 11, 23, 12, 0, 0, tzinfo=UTC)


def _scenario() -> Scenario:
    return Scenario(
        id="11",
        technique="T1003.008",
        name="read shadow",
        tactic="Credential Access",
        pod="victim",
        namespace="victim",
        benign=False,
        expected_tuned="detect",
        expected_enforce="block",
        requires=(),
        signals=(Matcher("kprobe", "cred-files", None, None, None),),
        directory=Path(),
    )


def _event(
    offset_ms: float,
    *,
    pod: str = "victim",
    action: str | None = "KPROBE_ACTION_POST",
) -> Event:
    return Event(
        kind="kprobe",
        time=MARKER + timedelta(milliseconds=offset_ms),
        pod=pod,
        namespace="victim",
        binary="/usr/bin/cat",
        arguments="/etc/shadow",
        policy="cred-files",
        function="security_file_open",
        action=action,
    )


def test_event_before_marker_ignored() -> None:
    result = attribute([_event(-1)], _scenario(), marker=MARKER, window_s=5)
    assert not result.detected
    assert result.latency_ms is None


def test_event_after_window_ignored() -> None:
    result = attribute([_event(5001)], _scenario(), marker=MARKER, window_s=5)
    assert not result.detected


def test_other_pod_ignored() -> None:
    result = attribute(
        [_event(10, pod="other")], _scenario(), marker=MARKER, window_s=5
    )
    assert not result.detected


def test_latency_is_first_match() -> None:
    events = [_event(300), _event(120), _event(900)]
    result = attribute(events, _scenario(), marker=MARKER, window_s=5)
    assert result.detected
    assert result.latency_ms == 120


def test_enforcement_seen_from_action() -> None:
    kill = attribute(
        [_event(10, action="KPROBE_ACTION_SIGKILL")],
        _scenario(),
        marker=MARKER,
        window_s=5,
    )
    post = attribute([_event(10)], _scenario(), marker=MARKER, window_s=5)
    assert kill.enforcement_seen
    assert not post.enforcement_seen
