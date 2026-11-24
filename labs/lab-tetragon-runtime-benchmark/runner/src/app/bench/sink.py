"""Decides from the attacker pod's log whether a scenario reached a sink."""

from __future__ import annotations

import json


def _entries(log_text: str) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for line in log_text.splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict):
            entries.append(entry)
    return entries


def _matches(entry: dict[str, object], sink: str, peer: str, since_ms: int) -> bool:
    time_ms = entry.get("time_ms")
    return (
        entry.get("sink") == sink
        and entry.get("peer") == peer
        and isinstance(time_ms, int)
        and time_ms >= since_ms
    )


def sink_connected(log_text: str, *, sink: str, peer: str, since_ms: int) -> bool:
    """True when `peer` reached `sink` at or after `since_ms` (epoch ms).

    Lines that are not JSON objects (restarts, partial lines) are skipped.
    """
    return any(_matches(entry, sink, peer, since_ms) for entry in _entries(log_text))
