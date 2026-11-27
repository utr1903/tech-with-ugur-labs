from __future__ import annotations

from datetime import date

import httpx
import pytest

from app.ldr.research_test import FakeClock, _service, _session, flaky
from app.ldr.runner import run_ldr_question
from app.ldr.session import LdrSession
from app.logging_setup import Logger, get_logger
from app.questions.catalog import get_question
from app.runs.record import RunRecord

_TODAY = date(2026, 11, 20)


@pytest.fixture
def log() -> Logger:
    return get_logger()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


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
    assert record.cost_usd == pytest.approx(10.0 / 3600 * 5.71915)
    assert record.meta == {
        "research_id": "r1",
        "model": "qwen3.6-27b",
        "ldr_version": "2.0.4",
        "instance_price_usd_per_hour": 5.71915,
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


def test_timeout_terminates_the_research(log: Logger, clock: FakeClock) -> None:
    terminated: list[str] = []
    inner = _service(["in_progress"] * 50)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/api/terminate/"):
            terminated.append(request.url.path)
            return httpx.Response(200, json={"status": "success"})
        return inner(request)

    record = _run_question(_session(handler), clock, log)

    assert record.status == "timeout"
    assert terminated == ["/api/terminate/r1"]
    assert record.meta["terminated"] is True


def test_failed_terminate_does_not_raise(log: Logger, clock: FakeClock) -> None:
    record = _run_question(_session(_service(["in_progress"] * 50)), clock, log)

    assert record.meta["terminated"] is False


def test_transient_poll_failure_still_completes(log: Logger, clock: FakeClock) -> None:
    handler = flaky(_service(["completed"]), {"/api/research/r1/status": 1})

    record = _run_question(_session(handler), clock, log)

    assert record.status == "completed"


def test_persistent_failure_is_a_failed_record_with_error(
    log: Logger, clock: FakeClock
) -> None:
    handler = flaky(_service([]), {"/api/research/r1/status": 99})

    record = _run_question(_session(handler), clock, log)

    assert record.status == "failed"
    assert record.report == ""
    assert "500" in str(record.meta["error"])
    assert record.meta["research_id"] == "r1"


def test_report_collection_failure_is_a_failed_record(
    log: Logger, clock: FakeClock
) -> None:
    handler = flaky(_service(["completed"]), {"/api/report/r1": 99})

    record = _run_question(_session(handler), clock, log)

    assert record.status == "failed"
    assert "error" in record.meta
