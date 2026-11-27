"""Streaming a run's events with resume, dedupe and an overall deadline."""

from __future__ import annotations

import time
from collections.abc import Iterator

import httpx

from app.errors import HermesError
from app.hermes.models import TERMINAL_EVENTS, RunEvent
from app.hermes.sse import parse_sse
from app.logging_setup import Logger

MAX_RECONNECTS = 5
_PREVIEW_CHARS = 200
_LOGGED_TOOL_EVENTS = ("tool.started", "tool.completed", "tool.failed")


def stream_run_events(
    http: httpx.Client,
    headers: dict[str, str],
    run_id: str,
    *,
    timeout_s: float,
    log: Logger,
) -> Iterator[RunEvent]:
    """Yields a run's events once each, in order, through the terminal one.

    Reconnects up to MAX_RECONNECTS times when the connection drops or ends
    before a terminal event, asking only for events after the highest seq seen.
    """
    deadline = time.monotonic() + timeout_s
    last_seq: int | None = None
    reconnects = 0
    log.info("Streaming run...", run_id=run_id, timeout_s=timeout_s)
    while True:
        try:
            for event in _read_stream(http, headers, run_id, last_seq):
                if time.monotonic() >= deadline:
                    raise HermesError(f"Run {run_id} passed its {timeout_s}s deadline.")
                if last_seq is not None and event.seq <= last_seq:
                    continue
                last_seq = event.seq
                _log_event(log, run_id, event)
                yield event
                if event.event in TERMINAL_EVENTS:
                    log.info(
                        "Streaming run succeeded.", run_id=run_id, last_seq=last_seq
                    )
                    return
        except httpx.TransportError as err:
            log.warning("Run stream dropped.", run_id=run_id, error=type(err).__name__)
        reconnects += 1
        if reconnects > MAX_RECONNECTS:
            raise HermesError(
                f"Run {run_id} stream failed after {MAX_RECONNECTS} reconnects."
            )
        if time.monotonic() >= deadline:
            raise HermesError(f"Run {run_id} passed its {timeout_s}s deadline.")
        log.warning(
            "Reconnecting run stream...",
            run_id=run_id,
            attempt=reconnects,
            last_seq=last_seq,
        )


def _read_stream(
    http: httpx.Client, headers: dict[str, str], run_id: str, last_seq: int | None
) -> Iterator[RunEvent]:
    params = {} if last_seq is None else {"last_seq": last_seq}
    route = f"/v1/runs/{run_id}/events"
    with http.stream("GET", route, params=params, headers=headers) as response:
        if response.status_code >= 400:
            response.read()
            raise HermesError(
                f"GET {route} returned {response.status_code}: {response.text[:300]}"
            )
        for payload in parse_sse(response.iter_lines()):
            yield _to_event(payload)


def _to_event(payload: dict[str, object]) -> RunEvent:
    event, seq = payload.get("event"), payload.get("seq")
    if not isinstance(event, str) or not isinstance(seq, int):
        raise HermesError("Run stream sent an event without `event` and `seq`.")
    return RunEvent(event=event, seq=seq, data=payload)


def _log_event(log: Logger, run_id: str, event: RunEvent) -> None:
    if event.event in _LOGGED_TOOL_EVENTS:
        preview = str(event.data.get("preview", ""))[:_PREVIEW_CHARS]
        log.info(
            "Run tool event.",
            run_id=run_id,
            event_name=event.event,
            tool=event.data.get("tool"),
            tool_call_id=event.data.get("tool_call_id"),
            error=event.data.get("error"),
            preview=preview,
        )
