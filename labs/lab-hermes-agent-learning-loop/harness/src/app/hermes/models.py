"""Plain data returned by the Hermes API client."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

TERMINAL_EVENTS = frozenset(
    {"run.completed", "run.failed", "run.cancelled", "run.interrupted"}
)


@dataclass(frozen=True)
class RunEvent:
    """One event from a run's SSE stream. `data` is the full payload."""

    event: str
    seq: int
    data: Mapping[str, object]


@dataclass(frozen=True)
class SessionRow:
    """One row of `GET /api/sessions`, reduced to what the harness uses."""

    id: str
    source: str
    parent_session_id: str | None
    model: str
    input_tokens: int
    output_tokens: int
    tool_call_count: int
