"""Tests for matching attacker sink log lines to a scenario run."""

from __future__ import annotations

from app.bench.sink import sink_connected

LOG = "\n".join(
    [
        '{"sink": "revshell", "peer": "10.244.0.6", "time_ms": 1000}',
        '{"sink": "http", "peer": "10.244.0.7", "time_ms": 2000}',
        "not json",
        '{"sink": "stratum", "peer": "10.244.0.7"',
        '["a", "list"]',
    ]
)


def test_matches_sink_peer_and_time() -> None:
    assert sink_connected(LOG, sink="revshell", peer="10.244.0.6", since_ms=1000)


def test_connection_before_marker_is_ignored() -> None:
    assert not sink_connected(LOG, sink="revshell", peer="10.244.0.6", since_ms=1001)


def test_other_peer_is_ignored() -> None:
    assert not sink_connected(LOG, sink="revshell", peer="10.244.0.7", since_ms=0)


def test_other_sink_is_ignored() -> None:
    assert not sink_connected(LOG, sink="stratum", peer="10.244.0.6", since_ms=0)


def test_malformed_lines_are_skipped() -> None:
    assert not sink_connected(LOG, sink="stratum", peer="10.244.0.7", since_ms=0)
    assert sink_connected(LOG, sink="http", peer="10.244.0.7", since_ms=0)
