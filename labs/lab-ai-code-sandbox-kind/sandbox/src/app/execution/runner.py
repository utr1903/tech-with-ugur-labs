"""Runs one program in its own awaited subprocess and working directory."""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
import sys
import time
from pathlib import Path

from app.config import Settings
from app.errors import ExecutionError
from app.execution.capture import BoundedCapture
from app.execution.models import ExecutionOutcome, ExecutionStatus
from app.execution.result_file import read_result_file
from app.execution.workspace import execution_directory
from app.logging_setup import Logger

_PIPE_DRAIN_GRACE_SECONDS = 2.0
_THREAD_LIMIT_VARS = ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS")


def _minimal_env(workdir: Path) -> dict[str, str]:
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": str(workdir),
        "TMPDIR": str(workdir),
        "LANG": "C.UTF-8",
    }
    env.update(dict.fromkeys(_THREAD_LIMIT_VARS, "1"))
    return env


def _kill_group(pid: int) -> None:
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        return  # The group already exited: nothing left to stop.


def _require_pipe(
    stream: asyncio.StreamReader | None, name: str
) -> asyncio.StreamReader:
    """Narrows an optional subprocess pipe, since `PIPE` always creates one."""
    if stream is None:
        raise ExecutionError(f"subprocess {name} pipe was not created")
    return stream


async def run_code(
    code: str, *, settings: Settings, runs_root: Path, log: Logger
) -> ExecutionOutcome:
    """Executes `code` with `python -I -u` and returns once it ends or times out."""
    started = time.monotonic()
    try:
        log.info("Executing code...", code_bytes=len(code.encode("utf-8")))
        with execution_directory(runs_root, log=log) as workdir:
            (workdir / "main.py").write_text(code, encoding="utf-8")
            outcome = await _execute(workdir, settings=settings, started=started)
    except Exception:
        log.exception("Executing code failed.", code_bytes=len(code.encode("utf-8")))
        raise
    else:
        log.info(
            "Executing code succeeded.",
            status=outcome.status.value,
            exit_code=outcome.exit_code,
            duration_ms=outcome.duration_ms,
            truncated=outcome.truncated,
        )
        return outcome


async def _execute(
    workdir: Path, *, settings: Settings, started: float
) -> ExecutionOutcome:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        "-u",
        "main.py",
        cwd=workdir,
        env=_minimal_env(workdir),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    stdout_pipe = _require_pipe(process.stdout, "stdout")
    stderr_pipe = _require_pipe(process.stderr, "stderr")
    stdout = BoundedCapture(limit=settings.max_output_bytes)
    stderr = BoundedCapture(limit=settings.max_output_bytes)
    drains = asyncio.gather(stdout.drain(stdout_pipe), stderr.drain(stderr_pipe))
    timed_out = False
    try:
        await asyncio.wait_for(
            process.wait(), timeout=settings.execution_timeout_seconds
        )
    except TimeoutError:
        timed_out = True
    finally:
        _kill_group(process.pid)
        await process.wait()
    # A detached descendant may still hold a pipe open; keep whatever arrived.
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(drains, timeout=_PIPE_DRAIN_GRACE_SECONDS)
    result = read_result_file(workdir, limit=settings.max_result_bytes)
    out, err = stdout.snapshot(), stderr.snapshot()
    return ExecutionOutcome(
        status=_status(process.returncode, timed_out=timed_out),
        exit_code=None if timed_out else process.returncode,
        stdout=out.text,
        stderr=err.text,
        result=result.value,
        result_error=result.error,
        duration_ms=int((time.monotonic() - started) * 1000),
        truncated=out.truncated or err.truncated,
    )


def _status(returncode: int | None, *, timed_out: bool) -> ExecutionStatus:
    if timed_out:
        return ExecutionStatus.TIMED_OUT
    return ExecutionStatus.SUCCEEDED if returncode == 0 else ExecutionStatus.FAILED
