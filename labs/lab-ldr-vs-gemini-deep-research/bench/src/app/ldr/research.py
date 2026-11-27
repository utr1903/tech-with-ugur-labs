"""Starting, awaiting and collecting one Local Deep Research run."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from app.errors import LdrError
from app.ldr.session import LdrSession
from app.logging_setup import Logger

_STARTED = ("success", "queued")
_FAILED = ("failed", "error", "cancelled")
_MAX_POLL_FAILURES = 5
_FETCH_ATTEMPTS = 3
_FETCH_RETRY_SECONDS = 5.0


@dataclass(frozen=True)
class LdrReport:
    """The finished report, its de-duplicated source URLs and LDR's metadata."""

    content: str
    sources: tuple[str, ...]
    metadata: Mapping[str, object]


# "quick" is one agent research followed by a summary. "detailed" builds a
# multi-section report and runs a fresh research per section, which takes
# several times longer and buries the answer block the scorer needs.
_MODE = "quick"


def start_research(session: LdrSession, prompt: str, *, log: Logger) -> str:
    """Submits the prompt and returns the research id (running or queued)."""
    try:
        log.info("Starting research...", prompt_chars=len(prompt))
        reply = session.post_json(
            "/api/start_research", {"query": prompt, "mode": _MODE}
        )
        research_id = _research_id(reply)
    except LdrError:
        log.exception("Starting research failed.", prompt_chars=len(prompt))
        raise
    else:
        log.info("Starting research succeeded.", research_id=research_id)
        return research_id


def _research_id(reply: Mapping[str, object]) -> str:
    if reply.get("status") not in _STARTED or not reply.get("research_id"):
        raise LdrError(f"research was not started: status {reply.get('status')!r}")
    return str(reply["research_id"])


def wait_for_research(
    session: LdrSession,
    research_id: str,
    *,
    clock: Callable[[], float],
    sleep: Callable[[float], None],
    log: Logger,
) -> str:
    """Polls until LDR reports a terminal status or the timeout passes.

    Returns `completed`, `failed`, `suspended` or `timeout`.
    """
    deadline = clock() + session.settings.timeout_seconds
    failures = 0
    try:
        log.info("Waiting for research...", research_id=research_id)
        while True:
            try:
                reply = session.get_json(f"/api/research/{research_id}/status")
            except LdrError as err:
                failures += 1
                if failures >= _MAX_POLL_FAILURES:
                    raise
                log.warning("Status poll failed.", failures=failures, error=str(err))
                status = None
            else:
                failures = 0
                status = _terminal(str(reply.get("status")))
            if status is not None:
                break
            if clock() >= deadline:
                status = "timeout"
                break
            sleep(session.settings.poll_seconds)
    except LdrError:
        log.exception("Waiting for research failed.", research_id=research_id)
        raise
    else:
        log.info("Waiting for research succeeded.", status=status)
        return status


def _terminal(status: str) -> str | None:
    if status in ("completed", "suspended"):
        return status
    return "failed" if status in _FAILED else None


def terminate_research(session: LdrSession, research_id: str, *, log: Logger) -> bool:
    """Best-effort stop of a research that must not keep running; never raises."""
    try:
        log.info("Terminating research...", research_id=research_id)
        session.post_json(f"/api/terminate/{research_id}", {})
    except LdrError:
        log.exception("Terminating research failed.", research_id=research_id)
        return False
    else:
        log.info("Terminating research succeeded.", research_id=research_id)
        return True


def _retrying[T](
    call: Callable[[], T], *, sleep: Callable[[float], None], log: Logger
) -> T:
    for attempt in range(1, _FETCH_ATTEMPTS):
        try:
            return call()
        except LdrError as err:
            log.warning("Fetch failed, retrying.", attempt=attempt, error=str(err))
            sleep(_FETCH_RETRY_SECONDS)
    return call()


def fetch_report(
    session: LdrSession,
    research_id: str,
    *,
    sleep: Callable[[float], None],
    log: Logger,
) -> LdrReport:
    """Downloads the finished report and its sources."""
    try:
        log.info("Fetching report...", research_id=research_id)
        data = _retrying(
            lambda: session.get_json(f"/api/report/{research_id}"), sleep=sleep, log=log
        )
        report = LdrReport(
            content=str(data.get("content") or ""),
            sources=_urls(data.get("sources")),
            metadata=_object(data.get("metadata")),
        )
    except LdrError:
        log.exception("Fetching report failed.", research_id=research_id)
        raise
    else:
        log.info("Fetching report succeeded.", sources=len(report.sources))
        return report


def fetch_duration(
    session: LdrSession,
    research_id: str,
    *,
    sleep: Callable[[float], None],
    log: Logger,
) -> float | None:
    """LDR's own duration for the research in seconds; None if unavailable."""
    try:
        log.info("Fetching duration...", research_id=research_id)
        data = _retrying(
            lambda: session.get_json(f"/history/report/{research_id}"),
            sleep=sleep,
            log=log,
        )
        duration = _object(data.get("metadata")).get("duration")
    except LdrError:
        log.exception("Fetching duration failed.", research_id=research_id)
        return None
    else:
        log.info("Fetching duration succeeded.", duration=duration)
        return float(duration) if isinstance(duration, int | float) else None


def _object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    return {str(k): v for k, v in value.items()}


def _urls(value: object) -> tuple[str, ...]:
    entries = value if isinstance(value, list) else []
    urls = (_object(e).get("url") for e in entries)
    return tuple(dict.fromkeys(str(u) for u in urls if u))
