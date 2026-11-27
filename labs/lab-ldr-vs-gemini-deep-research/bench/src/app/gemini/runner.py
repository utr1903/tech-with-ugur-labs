"""Running one benchmark question through Gemini and describing it as a run record."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime

from app.gemini.client import GeminiSettings, sdk_version
from app.gemini.cost import gemini_cost_usd
from app.gemini.interactions import InteractionsApi, run_interaction, urls_in_text
from app.logging_setup import Logger
from app.questions.catalog import Question, build_prompt
from app.runs.record import RunRecord


def run_gemini_question(
    api: InteractionsApi,
    settings: GeminiSettings,
    question: Question,
    *,
    run: int,
    today: date,
    clock: Callable[[], float],
    sleep: Callable[[float], None],
    log: Logger,
) -> RunRecord:
    """Runs one question; anything but a finished report is recorded as a failure.

    Only an interaction that never started raises.
    """
    log = log.bind(question_id=question.id, run=run)
    started_at = datetime.now(UTC).isoformat(timespec="seconds")
    result, wall = run_interaction(
        api,
        build_prompt(question, today=today),
        agent=settings.agent,
        poll_seconds=settings.poll_seconds,
        timeout_seconds=settings.timeout_seconds,
        clock=clock,
        sleep=sleep,
        log=log,
    )
    meta: dict[str, object] = {
        "agent": settings.agent,
        "interaction_id": result.id,
        "api_version": settings.api_version,
        "sdk_version": sdk_version(),
    }
    if result.status != "completed":
        meta["gemini_status"] = result.status
    if result.errors:
        meta["error"] = "; ".join(result.errors)
    return RunRecord(
        tool="gemini",
        question_id=question.id,
        run=run,
        started_at=started_at,
        wall_seconds=wall,
        status=result.status if result.status in ("completed", "timeout") else "failed",
        report=result.report,
        sources=result.citations or urls_in_text(result.report),
        usage=result.usage,
        cost_usd=gemini_cost_usd(result.usage),
        meta=meta,
    )
