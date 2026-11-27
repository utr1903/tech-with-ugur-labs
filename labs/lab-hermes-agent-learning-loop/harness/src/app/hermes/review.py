"""Waits for Hermes's post-turn background review by reading `agent.log`."""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.logging_setup import Logger

_LINE = re.compile(
    r"^(?P<ts>\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(?:,\d+)? (?P<level>\w+)"
    r"(?: \[(?P<sid>[^\]]+)\])? (?P<logger>\S+): (?P<msg>.*)$"
)
_COMPLETE = re.compile(
    r"Background review complete:.*?calls=(?P<calls>\d+)"
    r".*?in=(?P<in>\d+).*?out=(?P<out>\d+).*?result=(?P<result>[\w+]+)"
)
_FAILED = "Background memory/skill review failed"
_STARTED_MARKERS = ("bg-review", "Background review")


@dataclass(frozen=True)
class ReviewOutcome:
    """How the background review ended and what it cost."""

    result: str
    calls: int
    input_tokens: int
    output_tokens: int


class _LogTail:
    """Reads new complete lines of a growing file, by byte offset."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._offset = 0

    def new_lines(self) -> list[str]:
        try:
            size = self._path.stat().st_size
            if size < self._offset:  # truncated or rotated
                self._offset = 0
            with self._path.open("rb") as handle:
                handle.seek(self._offset)
                chunk = handle.read()
        except OSError:
            return []
        end = chunk.rfind(b"\n")
        if end < 0:
            return []
        self._offset += end + 1
        return chunk[:end].decode("utf-8", errors="replace").splitlines()


def _ours(
    line: str, session_id: str, started_after: datetime
) -> tuple[str, str] | None:
    """Returns (message, logger) if the line belongs to this run, else None."""
    match = _LINE.match(line)
    if match is None:
        return None
    sid = match["sid"]
    if sid is not None and sid != session_id:
        return None
    stamp = datetime.strptime(match["ts"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
    if stamp < started_after:
        return None
    return match["msg"], match["logger"]


def _classify(msg: str, logger: str) -> ReviewOutcome | bool:
    """A finished outcome, True if the review started, False if unrelated."""
    done = _COMPLETE.search(msg)
    if done is not None:
        return ReviewOutcome(
            done["result"], int(done["calls"]), int(done["in"]), int(done["out"])
        )
    if _FAILED in msg:
        return ReviewOutcome("error", 0, 0, 0)
    return any(m in msg or m in logger for m in _STARTED_MARKERS)


def wait_for_review(
    agent_log: Path,
    session_id: str,
    *,
    started_after: datetime,
    log: Logger,
    grace_s: float = 60,
    timeout_s: float = 600,
    poll_s: float = 2,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> ReviewOutcome:
    """Polls `agent_log` until the review of `session_id` completes or fails."""
    log.info(
        "Waiting for background review...",
        session_id=session_id,
        grace_s=grace_s,
        timeout_s=timeout_s,
    )
    tail = _LogTail(agent_log)
    began = clock()
    started = False
    while True:
        for line in tail.new_lines():
            seen = _ours(line, session_id, started_after)
            if seen is None:
                continue
            verdict = _classify(*seen)
            if isinstance(verdict, ReviewOutcome):
                log.info(
                    "Waiting for background review succeeded.",
                    result=verdict.result,
                    calls=verdict.calls,
                )
                return verdict
            if verdict and not started:
                started = True
                log.info("Background review started.", session_id=session_id)
        elapsed = clock() - began
        if not started and elapsed >= grace_s:
            return _giveup("not_started", log, session_id)
        if elapsed >= timeout_s:
            return _giveup("timeout", log, session_id)
        sleep(poll_s)


def _giveup(result: str, log: Logger, session_id: str) -> ReviewOutcome:
    log.warning(
        "Background review did not finish.", result=result, session_id=session_id
    )
    return ReviewOutcome(result, 0, 0, 0)
