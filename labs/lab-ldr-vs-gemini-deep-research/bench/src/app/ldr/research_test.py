from __future__ import annotations

import json
from collections.abc import Callable
from datetime import date

import httpx
import pytest

from app.errors import LdrError
from app.ldr.research import (
    fetch_duration,
    fetch_report,
    run_ldr_question,
    start_research,
    wait_for_research,
)
from app.ldr.session import LdrSession, LdrSettings
from app.logging_setup import Logger, get_logger
from app.questions.catalog import get_question
from app.runs.record import RunRecord

_TODAY = date(2026, 11, 20)


class FakeClock:
    """A clock that only moves when the code under test sleeps."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def log() -> Logger:
    return get_logger()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


def _session(handler: Callable[[httpx.Request], httpx.Response]) -> LdrSession:
    settings = LdrSettings(
        base_url="http://ldr:5000",
        username="lab",
        password="pw",
        model="qwen3.6-27b",
        poll_seconds=10.0,
        timeout_seconds=100.0,
    )
    session = LdrSession(httpx.Client(transport=httpx.MockTransport(handler)), settings)
    session.csrf_token = "api-tok"
    return session


def _service(statuses: list[str]) -> Callable[[httpx.Request], httpx.Response]:
    remaining = list(statuses)
    report = {
        "content": "# Report",
        "sources": [{"url": "https://a"}, {"url": "https://b"}, {"url": "https://a"}],
        "metadata": {"strategy": "source-based"},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/start_research":
            return httpx.Response(
                200, json={"status": "queued", "research_id": "r1", "queue_position": 1}
            )
        if path == "/api/research/r1/status":
            return httpx.Response(200, json={"status": remaining.pop(0)})
        if path == "/api/report/r1":
            return httpx.Response(200, json=report)
        if path == "/history/report/r1":
            return httpx.Response(200, json={"metadata": {"duration": 812}})
        return httpx.Response(404)

    return handler


def test_start_research_sends_csrf_and_returns_id(log: Logger) -> None:
    captured: list[httpx.Request] = []
    inner = _service([])

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return inner(request)

    assert start_research(_session(handler), "the prompt", log=log) == "r1"
    assert captured[0].headers["X-CSRFToken"] == "api-tok"
    assert json.loads(captured[0].content) == {
        "query": "the prompt",
        "mode": "detailed",
    }


def test_start_research_rejects_unexpected_status(log: Logger) -> None:
    session = _session(
        lambda _: httpx.Response(200, json={"status": "error", "message": "x"})
    )

    with pytest.raises(LdrError, match="error"):
        start_research(session, "p", log=log)


def test_wait_polls_until_completed(log: Logger, clock: FakeClock) -> None:
    session = _session(_service(["in_progress", "in_progress", "completed"]))

    status = wait_for_research(session, "r1", clock=clock, sleep=clock.sleep, log=log)

    assert status == "completed"
    assert clock.now == 1020.0


def test_wait_times_out(log: Logger, clock: FakeClock) -> None:
    session = _session(_service(["in_progress"] * 50))

    status = wait_for_research(session, "r1", clock=clock, sleep=clock.sleep, log=log)

    assert status == "timeout"
    assert clock.now >= 1100.0


@pytest.mark.parametrize("terminal", ["failed", "suspended"])
def test_wait_returns_terminal_failures(
    terminal: str, log: Logger, clock: FakeClock
) -> None:
    session = _session(_service(["queued", terminal]))

    status = wait_for_research(session, "r1", clock=clock, sleep=clock.sleep, log=log)

    assert status == terminal


def test_fetch_report_dedupes_sources_in_order(log: Logger) -> None:
    report = fetch_report(_session(_service([])), "r1", log=log)

    assert report.content == "# Report"
    assert report.sources == ("https://a", "https://b")
    assert report.metadata == {"strategy": "source-based"}


def test_fetch_duration(log: Logger) -> None:
    assert fetch_duration(_session(_service([])), "r1", log=log) == 812.0


def test_fetch_duration_missing_is_none(log: Logger) -> None:
    session = _session(lambda _: httpx.Response(200, json={"metadata": {}}))

    assert fetch_duration(session, "r1", log=log) is None


def _run_question(session: LdrSession, clock: FakeClock, log: Logger) -> RunRecord:
    return run_ldr_question(
        session,
        get_question("q1-kev"),
        run=2,
        today=_TODAY,
        clock=clock,
        sleep=clock.sleep,
        log=log,
    )


def test_completed_run_record(log: Logger, clock: FakeClock) -> None:
    session = _session(_service(["in_progress", "completed"]))

    record = _run_question(session, clock, log)

    assert (record.tool, record.question_id, record.run) == ("ldr", "q1-kev", 2)
    assert record.status == "completed"
    assert record.report == "# Report"
    assert record.sources == ("https://a", "https://b")
    assert record.wall_seconds == 10.0
    assert record.cost_usd == pytest.approx(10.0 / 3600 * 2.8035)
    assert record.meta == {
        "research_id": "r1",
        "model": "qwen3.6-27b",
        "ldr_version": "2.0.4",
        "strategy": "source-based",
        "ldr_duration_seconds": 812.0,
    }


def test_price_override(log: Logger, clock: FakeClock) -> None:
    session = _session(_service(["completed"]))

    record = run_ldr_question(
        session,
        get_question("q1-kev"),
        run=1,
        today=_TODAY,
        clock=clock,
        sleep=clock.sleep,
        log=log,
        price_per_hour=3600.0,
    )

    assert record.cost_usd == pytest.approx(record.wall_seconds)


def test_failed_run_keeps_going_with_empty_report(
    log: Logger, clock: FakeClock
) -> None:
    record = _run_question(_session(_service(["failed"])), clock, log)

    assert record.status == "failed"
    assert record.report == ""
    assert record.sources == ()
    assert record.meta["research_id"] == "r1"


def test_suspended_run_is_recorded_as_failed(log: Logger, clock: FakeClock) -> None:
    record = _run_question(_session(_service(["suspended"])), clock, log)

    assert record.status == "failed"
    assert record.meta["ldr_status"] == "suspended"


def test_timed_out_run_has_timeout_status(log: Logger, clock: FakeClock) -> None:
    record = _run_question(_session(_service(["in_progress"] * 50)), clock, log)

    assert record.status == "timeout"
    assert record.report == ""
    assert record.wall_seconds >= 100.0
