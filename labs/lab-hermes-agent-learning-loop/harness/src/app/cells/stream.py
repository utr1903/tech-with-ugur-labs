"""Streaming one run to a JSONL file while measuring it."""

from __future__ import annotations

import json
import time
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

from app.errors import HermesError
from app.hermes.client import HermesApi
from app.hermes.models import TERMINAL_EVENTS
from app.logging_setup import Logger

STREAM_TIMEOUT_S = 1800.0
COMPLETED = "run.completed"


@dataclass(frozen=True)
class StreamOutcome:
    """How a run ended, what the parent used, and its tool calls."""

    status: str
    error: str | None
    input_tokens: int
    output_tokens: int
    tools: Counter[str]
    wall_seconds: float


def _usage(data: Mapping[str, object], key: str) -> int:
    usage = data.get("usage")
    value = usage.get(key) if isinstance(usage, dict) else None
    return value if isinstance(value, int) else 0


def stream_to_file(
    client: HermesApi,
    run_id: str,
    path: Path,
    *,
    log: Logger,
    timeout_s: float = STREAM_TIMEOUT_S,
    clock: Callable[[], float] = time.monotonic,
) -> StreamOutcome:
    """Writes every event as one JSON line; a deadline is a recorded error."""
    began = clock()
    status: str = "error"
    error: str | None = "stream ended without a terminal event"
    tokens, tools = (0, 0), Counter[str]()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as out:
        try:
            for event in client.stream_events(run_id, timeout_s=timeout_s):
                record = {"event": event.event, "seq": event.seq, "data": event.data}
                out.write(json.dumps(record, sort_keys=True) + "\n")
                tool = event.data.get("tool")
                if event.event == "tool.started" and isinstance(tool, str):
                    tools[tool] += 1
                if event.event in TERMINAL_EVENTS:
                    status, error = event.event, None
                    tokens = (
                        _usage(event.data, "input_tokens"),
                        _usage(event.data, "output_tokens"),
                    )
        except HermesError as err:
            status, error = "error", str(err)
            log.exception("Streaming run failed.", run_id=run_id)
    if status != COMPLETED:
        error = error or f"run ended as {status}"
    return StreamOutcome(status, error, *tokens, tools, round(clock() - began, 3))
