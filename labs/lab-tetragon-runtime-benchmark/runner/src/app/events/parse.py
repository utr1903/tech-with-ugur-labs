"""Turns one line of Tetragon JSON export into an Event, or None."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from app.events.model import Event

_KINDS: dict[str, Literal["exec", "kprobe"]] = {
    "process_exec": "exec",
    "process_kprobe": "kprobe",
}


def _text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _object(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def parse_event(line: str) -> Event | None:
    """Returns the event, or None for junk, other event types, or no pod."""
    try:
        raw = json.loads(line)
    except json.JSONDecodeError:
        return None
    top = _object(raw)
    for key, kind in _KINDS.items():
        if key in top:
            return _build(kind, _object(top[key]), top.get("time"))
    return None


def _build(
    kind: Literal["exec", "kprobe"], body: dict[str, object], raw_time: object
) -> Event | None:
    process = _object(body.get("process"))
    pod = _object(process.get("pod"))
    pod_name = _text(pod.get("name"))
    namespace = _text(pod.get("namespace"))
    time = _parse_time(raw_time)
    if not pod_name or namespace is None or time is None:
        return None
    return Event(
        kind=kind,
        time=time,
        pod=pod_name,
        namespace=namespace,
        binary=_text(process.get("binary")) or "",
        arguments=_text(process.get("arguments")) or "",
        policy=_text(body.get("policy_name")),
        function=_text(body.get("function_name")),
        action=_text(body.get("action")),
    )
