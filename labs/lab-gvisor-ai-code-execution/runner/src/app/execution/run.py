"""A fixed Python invocation; Kubernetes owns final classification."""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from app.errors import SourceLimitError
from app.execution.capture import drain
from app.execution.limits import SOURCE_BYTES, disable_dumpability, harden_child
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
        with subprocess.Popen(
            [sys.executable, "-I", "-B", "-u", "-c", source],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=Path.cwd(),
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/work"},
            start_new_session=True,
            preexec_fn=harden_child,
        ) as process:
            stdout, stderr, timed_out = drain(process)
            exit_code = process.wait(timeout=2)
    except Exception:
        log.exception("Executing source failed.", source_bytes=source_bytes)
        raise
    else:
        truncated = stdout.truncated or stderr.truncated
        write_record({"captureComplete": True, "captureTruncationReported": truncated})
        log.info(
            "Executing source succeeded.",
            stdout_bytes=len(stdout.data),
            stderr_bytes=len(stderr.data),
        )
        return CaptureResult(
            bytes(stdout.data),
            bytes(stderr.data),
            exit_code,
            timed_out,
            stdout.truncated,
            stderr.truncated,
        )
