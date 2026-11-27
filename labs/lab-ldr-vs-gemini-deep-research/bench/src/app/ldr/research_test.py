from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from app.errors import LdrError
from app.ldr.research import (
    fetch_duration,
    fetch_report,
    start_research,
    terminate_research,
    wait_for_research,
)
from app.ldr.session import LdrSession, LdrSettings
from app.logging_setup import Logger, get_logger


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
        "mode": "quick",
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


def test_fetch_report_dedupes_sources_in_order(log: Logger, clock: FakeClock) -> None:
    report = fetch_report(_session(_service([])), "r1", sleep=clock.sleep, log=log)

    assert report.content == "# Report"
    assert report.sources == ("https://a", "https://b")
    assert report.metadata == {"strategy": "source-based"}


def test_fetch_duration(log: Logger, clock: FakeClock) -> None:
    session = _session(_service([]))

    assert fetch_duration(session, "r1", sleep=clock.sleep, log=log) == 812.0


def test_fetch_duration_missing_is_none(log: Logger, clock: FakeClock) -> None:
    session = _session(lambda _: httpx.Response(200, json={"metadata": {}}))

    assert fetch_duration(session, "r1", sleep=clock.sleep, log=log) is None


def flaky(
    inner: Callable[[httpx.Request], httpx.Response], failures: dict[str, int]
) -> Callable[[httpx.Request], httpx.Response]:
    """Answers 500 the first `failures[path]` times a path is requested."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if failures.get(path, 0) > 0:
            failures[path] -= 1
            return httpx.Response(500)
        return inner(request)

    return handler


def test_one_failed_poll_does_not_stop_the_wait(log: Logger, clock: FakeClock) -> None:
    handler = flaky(
        _service(["in_progress", "completed"]), {"/api/research/r1/status": 1}
    )

    status = wait_for_research(
        _session(handler), "r1", clock=clock, sleep=clock.sleep, log=log
    )

    assert status == "completed"


def test_five_consecutive_poll_failures_raise(log: Logger, clock: FakeClock) -> None:
    handler = flaky(_service([]), {"/api/research/r1/status": 99})

    with pytest.raises(LdrError):
        wait_for_research(
            _session(handler), "r1", clock=clock, sleep=clock.sleep, log=log
        )


def test_fetch_report_retries_a_transient_failure(
    log: Logger, clock: FakeClock
) -> None:
    handler = flaky(_service([]), {"/api/report/r1": 2})

    report = fetch_report(_session(handler), "r1", sleep=clock.sleep, log=log)

    assert report.content == "# Report"


def test_fetch_duration_gives_up_quietly(log: Logger, clock: FakeClock) -> None:
    handler = flaky(_service([]), {"/history/report/r1": 99})

    assert fetch_duration(_session(handler), "r1", sleep=clock.sleep, log=log) is None


def test_terminate_posts_with_csrf(log: Logger) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"status": "success"})

    assert terminate_research(_session(handler), "r1", log=log) is True
    assert (seen[0].method, seen[0].url.path) == ("POST", "/api/terminate/r1")
    assert seen[0].headers["X-CSRFToken"] == "api-tok"


def test_terminate_failure_is_swallowed(log: Logger) -> None:
    session = _session(lambda _: httpx.Response(500))

    assert terminate_research(session, "r1", log=log) is False
