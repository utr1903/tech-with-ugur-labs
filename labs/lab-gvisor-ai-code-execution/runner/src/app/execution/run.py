"""A fixed Python invocation; Kubernetes owns final classification."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from app.errors import SourceLimitError
from app.execution.capture import drain
from app.execution.limits import (
    SOURCE_BYTES,
    WALL_SECONDS,
    disable_dumpability,
    harden_child,
)
from app.logging_setup import Logger
from app.output import write_record


@dataclass(frozen=True)
class CaptureResult:
    """Advisory capture results, never authoritative Job status."""

    stdout: bytes
    stderr: bytes
    exit_code: int
    timed_out: bool
    stdout_truncated: bool
    stderr_truncated: bool


def validate_source(source: str) -> None:
    """Reject UTF-8 source beyond the fixed 16 KiB limit."""
    if len(source.encode("utf-8")) > SOURCE_BYTES:
        raise SourceLimitError("Source exceeds 16384 UTF-8 bytes")


def run_source(source: str, *, log: Logger) -> CaptureResult:
    """Execute without accepting arbitrary argv, environment or limits."""
    validate_source(source)
    source_bytes = len(source.encode("utf-8"))
    try:
        log.info("Executing source...", source_bytes=source_bytes)
        disable_dumpability()
        result = _capture_source(source, deadline=time.monotonic() + WALL_SECONDS)
    except Exception:
        log.exception("Executing source failed.", source_bytes=source_bytes)
        raise
    else:
        truncated = result.stdout_truncated or result.stderr_truncated
        write_record({"captureComplete": True, "captureTruncationReported": truncated})
        log.info(
            "Capturing source output completed.",
            stdout_bytes=len(result.stdout),
            stderr_bytes=len(result.stderr),
        )
        return result


def _capture_source(source: str, *, deadline: float) -> CaptureResult:
    process = subprocess.Popen(
        [sys.executable, "-I", "-B", "-u", "-c", source],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=Path.cwd(),
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/work"},
        start_new_session=True,
        preexec_fn=harden_child,
    )
    try:
        stdout, stderr, timed_out = drain(process, deadline=deadline)
    finally:
        # Never use Popen.__exit__: its implicit wait is unbounded on exceptions.
        try:
            exit_code = _stop_and_reap(process)
        finally:
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()
    return CaptureResult(
        bytes(stdout.data),
        bytes(stderr.data),
        exit_code,
        timed_out,
        stdout.truncated,
        stderr.truncated,
    )


def _stop_and_reap(process: subprocess.Popen[bytes]) -> int:
    # A normally completed process group may already have disappeared.
    with suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGKILL)
    return process.wait(timeout=2)
