"""Starting, awaiting and collecting one Local Deep Research run."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime

from app.errors import LdrError
from app.ldr.session import LdrSession
from app.logging_setup import Logger
from app.questions.catalog import Question, build_prompt
from app.runs.record import RunRecord

INSTANCE_PRICE_USD_PER_HOUR = 2.8035
DEFAULT_LDR_VERSION = "2.0.4"
_STARTED = ("success", "queued")
_FAILED = ("failed", "error", "cancelled")


@dataclass(frozen=True)
class LdrReport:
    """The finished report, its de-duplicated source URLs and LDR's metadata."""

    content: str
    sources: tuple[str, ...]
    metadata: Mapping[str, object]


def start_research(session: LdrSession, prompt: str, *, log: Logger) -> str:
    """Submits the prompt and returns the research id (running or queued)."""
    try:
        log.info("Starting research...", prompt_chars=len(prompt))
        reply = session.post_json(
            "/api/start_research", {"query": prompt, "mode": "detailed"}
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
    try:
        log.info("Waiting for research...", research_id=research_id)
        while True:
            reply = session.get_json(f"/api/research/{research_id}/status")
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


def fetch_report(session: LdrSession, research_id: str, *, log: Logger) -> LdrReport:
    """Downloads the finished report and its sources."""
    try:
        log.info("Fetching report...", research_id=research_id)
        data = session.get_json(f"/api/report/{research_id}")
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
    session: LdrSession, research_id: str, *, log: Logger
) -> float | None:
    """LDR's own duration for the research in seconds, if it recorded one."""
    try:
        log.info("Fetching duration...", research_id=research_id)
        data = session.get_json(f"/history/report/{research_id}")
        duration = _object(data.get("metadata")).get("duration")
    except LdrError:
        log.exception("Fetching duration failed.", research_id=research_id)
        raise
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


def run_ldr_question(
    session: LdrSession,
    question: Question,
    *,
    run: int,
    today: date,
    clock: Callable[[], float],
    sleep: Callable[[float], None],
    log: Logger,
    price_per_hour: float = INSTANCE_PRICE_USD_PER_HOUR,
) -> RunRecord:
    """Runs one question; a failed or timed-out research still yields a record."""
    log = log.bind(question_id=question.id, run=run)
    started_at = datetime.now(UTC).isoformat(timespec="seconds")
    began = clock()
    research_id = start_research(session, build_prompt(question, today=today), log=log)
    status = wait_for_research(session, research_id, clock=clock, sleep=sleep, log=log)
    wall = clock() - began
    meta: dict[str, object] = {
        "research_id": research_id,
        "model": session.settings.model,
        "ldr_version": DEFAULT_LDR_VERSION,
    }
    report = LdrReport(content="", sources=(), metadata={})
    if status == "completed":
        report = fetch_report(session, research_id, log=log)
        meta.update(_report_meta(report))
        meta["ldr_duration_seconds"] = fetch_duration(session, research_id, log=log)
    else:
        meta["ldr_status"] = status
    return RunRecord(
        tool="ldr",
        question_id=question.id,
        run=run,
        started_at=started_at,
        wall_seconds=wall,
        status=status if status in ("completed", "timeout") else "failed",
        report=report.content,
        sources=report.sources,
        usage={},
        cost_usd=wall / 3600 * price_per_hour,
        meta=meta,
    )


def _report_meta(report: LdrReport) -> dict[str, object]:
    meta: dict[str, object] = {}
    for key in ("ldr_version", "strategy"):
        if key in report.metadata:
            meta[key] = report.metadata[key]
    return meta
