from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.hermes.review import ReviewOutcome, wait_for_review
from app.logging_setup import get_logger

LOG = get_logger()
START = datetime(2026, 11, 27, 18, 0, 0, tzinfo=UTC)
SID = "run_abc"


class FakeTime:
    def __init__(self) -> None:
        self.now = 0.0

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def _line(
    ts: str, msg: str, *, sid: str | None = SID, name: str = "agent.x", ms: str = "100"
) -> str:
    tag = f" [{sid}]" if sid else ""
    return f"2026-11-27 {ts},{ms} INFO{tag} {name}: {msg}\n"


DONE = (
    "Background review complete: thread=bg-review calls=3 in=12000 "
    "out=400 cache_read=10 result=skill+memory"
)


def _wait(log: Path, t: FakeTime, **kw: float) -> ReviewOutcome:
    return wait_for_review(
        log, SID, started_after=START, clock=t.clock, sleep=t.sleep, log=LOG, **kw
    )


def test_wait_review_returns_result(tmp_path: Path) -> None:
    log = tmp_path / "agent.log"
    log.write_text(
        _line("18:00:05", "Starting bg-review", name="agent.background_review")
        + _line("18:00:09", DONE, name="agent.background_review"),
        encoding="utf-8",
    )
    out = _wait(log, FakeTime())
    assert out == ReviewOutcome("skill+memory", 3, 12000, 400)


def test_wait_review_untagged_line_after_start(tmp_path: Path) -> None:
    log = tmp_path / "agent.log"
    log.write_text(
        _line("17:59:00", DONE, sid=None)  # before started_after: ignored
        + _line("18:00:09", DONE.replace("skill+memory", "none"), sid=None),
        encoding="utf-8",
    )
    assert _wait(log, FakeTime()).result == "none"


def test_wait_review_not_started_returns_after_grace(tmp_path: Path) -> None:
    log = tmp_path / "agent.log"
    log.write_text(_line("18:00:01", "conversation turn"), encoding="utf-8")
    t = FakeTime()
    out = _wait(log, t, grace_s=10, poll_s=2)
    assert out == ReviewOutcome("not_started", 0, 0, 0)
    assert 10 <= t.now < 20


def test_wait_review_missing_log_is_not_started(tmp_path: Path) -> None:
    out = _wait(tmp_path / "nope.log", FakeTime(), grace_s=4)
    assert out.result == "not_started"


def test_wait_review_timeout(tmp_path: Path) -> None:
    log = tmp_path / "agent.log"
    log.write_text(
        _line("18:00:05", "bg-review thread started", name="agent.background_review"),
        encoding="utf-8",
    )
    t = FakeTime()
    out = _wait(log, t, grace_s=5, timeout_s=30, poll_s=2)
    assert out == ReviewOutcome("timeout", 0, 0, 0)
    assert t.now >= 30


def test_wait_review_ignores_other_session(tmp_path: Path) -> None:
    log = tmp_path / "agent.log"
    log.write_text(
        _line("18:00:05", "bg-review started", sid="run_other")
        + _line("18:00:09", DONE, sid="run_other"),
        encoding="utf-8",
    )
    assert _wait(log, FakeTime(), grace_s=6).result == "not_started"


def test_wait_review_failure_is_error(tmp_path: Path) -> None:
    log = tmp_path / "agent.log"
    log.write_text(
        _line("18:00:05", "Background memory/skill review failed: boom"),
        encoding="utf-8",
    )
    assert _wait(log, FakeTime()) == ReviewOutcome("error", 0, 0, 0)


def test_wait_review_reads_incrementally_and_tolerates_partial_line(
    tmp_path: Path,
) -> None:
    log = tmp_path / "agent.log"
    full = _line("18:00:09", DONE)
    log.write_text(_line("18:00:05", "bg-review started") + full[:30], "utf-8")
    t = FakeTime()
    calls = 0

    def sleep(seconds: float) -> None:
        nonlocal calls
        calls += 1
        t.sleep(seconds)
        if calls == 2:
            with log.open("a", encoding="utf-8") as handle:
                handle.write(full[30:])

    out = wait_for_review(
        log,
        SID,
        started_after=START,
        clock=t.clock,
        sleep=sleep,
        log=LOG,
        grace_s=60,
        timeout_s=120,
        poll_s=2,
    )
    assert out.result == "skill+memory"
    assert calls == 2


def test_wait_review_filters_on_milliseconds(tmp_path: Path) -> None:
    half = datetime(2026, 11, 27, 18, 0, 0, 500_000, tzinfo=UTC)
    log = tmp_path / "agent.log"
    log.write_text(
        _line("18:00:00", DONE.replace("skill+memory", "none"), ms="100")
        + _line("18:00:00", DONE, ms="900"),
        encoding="utf-8",
    )
    out = wait_for_review(
        log,
        SID,
        started_after=half,
        clock=FakeTime().clock,
        sleep=lambda _: None,
        log=LOG,
    )
    assert out.result == "skill+memory"


def test_wait_review_ignores_same_session_line_before_start(tmp_path: Path) -> None:
    log = tmp_path / "agent.log"
    log.write_text(_line("17:59:00", DONE), encoding="utf-8")
    assert _wait(log, FakeTime(), grace_s=4).result == "not_started"
