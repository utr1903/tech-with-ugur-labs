"""Values produced by one execution."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ExecutionStatus(StrEnum):
    """How an executed program ended."""

    SUCCEEDED = "succeeded"
    FAILED = "failed"
    TIMED_OUT = "timed_out"


@dataclass(frozen=True)
class CapturedText:
    """At most `limit` bytes of a stream, decoded, plus whether more existed."""

    text: str
    truncated: bool


@dataclass(frozen=True)
class ResultFile:
    """The parsed result.json (or None) and why it was rejected, if it was."""

    value: object | None
    error: str | None


@dataclass(frozen=True)
class ExecutionOutcome:
    """Everything the caller learns about one execution."""

    status: ExecutionStatus
    exit_code: int | None
    stdout: str
    stderr: str
    result: object | None
    result_error: str | None
    duration_ms: int
    truncated: bool
