"""Running one benchmark question through LDR and describing it as a run record."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime

from app.errors import LdrError
from app.ldr.research import (
    LdrReport,
    fetch_duration,
    fetch_report,
    start_research,
    terminate_research,
    wait_for_research,
)
from app.ldr.session import LdrSession
from app.logging_setup import Logger
from app.questions.catalog import Question, build_prompt
from app.runs.record import RunRecord

INSTANCE_PRICE_USD_PER_HOUR = 5.71915
DEFAULT_LDR_VERSION = "2.0.4"


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
    """Runs one question; a failed or timed-out research still yields a record.

    Only a research that never started raises; once an id exists, every
    later failure is recorded so the batch can go on.
    """
    log = log.bind(question_id=question.id, run=run)
    started_at = datetime.now(UTC).isoformat(timespec="seconds")
    began = clock()
    research_id = start_research(session, build_prompt(question, today=today), log=log)
    meta: dict[str, object] = {
        "research_id": research_id,
        "model": session.settings.model,
        "ldr_version": DEFAULT_LDR_VERSION,
        "instance_price_usd_per_hour": price_per_hour,
    }
    report = LdrReport(content="", sources=(), metadata={})
    try:
        status = wait_for_research(
            session, research_id, clock=clock, sleep=sleep, log=log
        )
        wall = clock() - began
        if status == "completed":
            report = fetch_report(session, research_id, sleep=sleep, log=log)
            meta.update(_report_meta(report))
            meta["ldr_duration_seconds"] = fetch_duration(
                session, research_id, sleep=sleep, log=log
            )
        else:
            meta["ldr_status"] = status
    except LdrError as err:
        log.exception("Collecting the research failed.", research_id=research_id)
        wall = clock() - began
        status = "failed"
        report = LdrReport(content="", sources=(), metadata={})
        meta["error"] = str(err)
    if status == "timeout" or "error" in meta:
        meta["terminated"] = terminate_research(session, research_id, log=log)
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
