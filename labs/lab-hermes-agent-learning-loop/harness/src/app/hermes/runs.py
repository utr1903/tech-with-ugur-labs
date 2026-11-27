"""Streaming a run's events with resume, dedupe and an overall deadline."""

from __future__ import annotations

import time
from collections.abc import Callable, Generator, Iterable, Iterator
from contextlib import closing

import httpx

from app.errors import HermesError
from app.hermes.models import TERMINAL_EVENTS, RunEvent
from app.hermes.sse import parse_sse
from app.logging_setup import Logger

MAX_RECONNECTS = 5
BODY_CHARS = 300
_READ_TIMEOUT_S = 120.0
_CONNECT_TIMEOUT_S = 10.0
_PREVIEW_CHARS = 200
_LOGGED_TOOL_EVENTS = ("tool.started", "tool.completed", "tool.failed")


def stream_run_events(
    http: httpx.Client,
    headers: dict[str, str],
    run_id: str,
    *,
    timeout_s: float,
    log: Logger,
    clock: Callable[[], float] = time.monotonic,
) -> Iterator[RunEvent]:
    """Yields a run's events once each, in order, through the terminal one.

    Reconnects when the connection drops or ends before a terminal event
    (an unterminated trailing frame counts as a drop), asking only for events
    after the highest seq seen. MAX_RECONNECTS caps consecutive failures; any
    new event resets it. The deadline is checked on every line received,
    keepalive comments included.
    """
    deadline = clock() + timeout_s

    def check_deadline() -> None:
        if clock() >= deadline:
            raise HermesError(f"Run {run_id} passed its {timeout_s}s deadline.")

    last_seq: int | None = None
    failures = 0
    log.info("Streaming run...", run_id=run_id, timeout_s=timeout_s)
    while True:
        check_deadline()
        try:
            read_timeout = min(_READ_TIMEOUT_S, max(deadline - clock(), 0.1))
            stream = _read_stream(
                http, headers, run_id, last_seq, read_timeout, check_deadline
            )
            with closing(stream) as events:
                for event in events:
                    if last_seq is not None and event.seq <= last_seq:
                        continue
                    last_seq = event.seq
                    failures = 0
                    _log_event(log, run_id, event)
                    yield event
                    if event.event in TERMINAL_EVENTS:
                        log.info(
                            "Streaming run succeeded.",
                            run_id=run_id,
                            last_seq=last_seq,
                        )
                        return
        except httpx.TransportError as err:
            log.warning("Run stream dropped.", run_id=run_id, error=type(err).__name__)
        failures += 1
        if failures > MAX_RECONNECTS:
            raise HermesError(
                f"Run {run_id} stream failed after {MAX_RECONNECTS} reconnects."
            )
        log.warning(
            "Reconnecting run stream...",
            run_id=run_id,
            attempt=failures,
            last_seq=last_seq,
        )


def _read_stream(
    http: httpx.Client,
    headers: dict[str, str],
    run_id: str,
    last_seq: int | None,
    read_timeout: float,
    check_deadline: Callable[[], None],
) -> Generator[RunEvent]:
    params = {} if last_seq is None else {"last_seq": last_seq}
    route = f"/v1/runs/{run_id}/events"
    timeout = httpx.Timeout(read_timeout, connect=_CONNECT_TIMEOUT_S)
    with http.stream(
        "GET", route, params=params, headers=headers, timeout=timeout
    ) as response:
        if response.status_code >= 400:
            response.read()
            raise HermesError(
                f"GET {route} returned {response.status_code}: "
                f"{response.text[:BODY_CHARS]}"
            )
        lines = _checked(response.iter_lines(), check_deadline)
        for payload in parse_sse(lines):
            yield _to_event(payload)


def _checked(lines: Iterable[str], check: Callable[[], None]) -> Iterator[str]:
    for line in lines:
        check()
        yield line


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
