"""Real subprocess contract tests; Kubernetes supplies authoritative status."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest
from pytest import CaptureFixture, MonkeyPatch

from app.errors import SourceLimitError
from app.execution.run import run_source, validate_source
from app.logging_setup import configure_logging


def test_exact_calculation() -> None:
    result = run_source("print(6 * 7)", log=configure_logging(app_name="test"))
    assert result.stdout == b"42\n"
    assert result.exit_code == 0


def test_nonzero_stderr() -> None:
    result = run_source(
        "import sys; sys.stderr.write('marker'); sys.exit(7)",
        log=configure_logging(app_name="test"),
    )
    assert result.stderr == b"marker"
    assert result.exit_code == 7


def test_source_byte_limit() -> None:
    with pytest.raises(SourceLimitError):
        validate_source("é" * 8193)


def test_output_flood() -> None:
    result = run_source(
        "import os; os.write(1,b'x'*100000); os.write(2,b'y'*100000)",
        log=configure_logging(app_name="test"),
    )
    assert result.stdout == b"x" * 8192
    assert result.stderr == b"y" * 8192
    assert result.stdout_truncated and result.stderr_truncated


def test_wall_timeout_retains_marker() -> None:
    start = time.monotonic()
    result = run_source(
        "print('marker',flush=True)\nwhile True: pass",
        log=configure_logging(app_name="test"),
    )
    assert result.timed_out
    assert result.stdout == b"marker\n"
    assert time.monotonic() - start < 12


def test_child_cannot_raise_process_hard_limit() -> None:
    source = (
        "import resource\na,b=resource.getrlimit(resource.RLIMIT_NPROC)\n"
        "print(a,b)\ntry: resource.setrlimit(resource.RLIMIT_NPROC,(b+1,b+1))\n"
        "except (ValueError,PermissionError): print('denied')"
    )
    result = run_source(source, log=configure_logging(app_name="test"))
    assert result.stdout == b"32 32\ndenied\n"


def test_supervisor_tampering_is_not_success() -> None:
    # A sibling supervised invocation prevents deliberately killing pytest itself.
    import os
    import subprocess
    import sys

    source = (
        "import os,signal; print('tamper',flush=True); "
        "os.kill(os.getppid(),signal.SIGKILL)"
    )
    result = subprocess.run(
        [sys.executable, "-m", "app"],
        env={**os.environ, "PYTHON_SOURCE": source},
        capture_output=True,
        timeout=12,
        check=False,
    )
    assert result.returncode != 0


def test_closed_streams_keep_watchdog_and_reap_child(tmp_path: Path) -> None:
    pid_file = tmp_path / "child-pid"
    source = (
        f"import os,time,pathlib; pathlib.Path({str(pid_file)!r})"
        ".write_text(str(os.getpid())); os.close(1); os.close(2); time.sleep(15)"
    )
    start = time.monotonic()
    result = run_source(source, log=configure_logging(app_name="test"))
    assert result.timed_out
    assert 9.5 <= time.monotonic() - start < 12
    _assert_child_gone(pid_file)


def test_short_child_with_closed_streams_completes() -> None:
    result = run_source(
        "import os,time; os.close(1); os.close(2); time.sleep(.2)",
        log=configure_logging(app_name="test"),
    )
    assert result.exit_code == 0
    assert not result.timed_out
    assert result.stdout == result.stderr == b""


def test_capture_exception_kills_and_reaps_child(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    pid_file = tmp_path / "child-pid"
    source = (
        f"import os,time,pathlib; pathlib.Path({str(pid_file)!r})"
        ".write_text(str(os.getpid())); print('marker',flush=True); time.sleep(5)"
    )
    monkeypatch.setattr("app.execution.capture.write_chunk", _fail_capture)
    start = time.monotonic()
    with pytest.raises(OSError, match="capture unavailable"):
        run_source(source, log=configure_logging(app_name="test"))
    assert time.monotonic() - start < 2
    _assert_child_gone(pid_file)


def test_nonzero_capture_log_is_neutral(capsys: CaptureFixture[str]) -> None:
    result = run_source("raise SystemExit(7)", log=configure_logging(app_name="test"))
    events = [
        json.loads(line).get("event") for line in capsys.readouterr().out.splitlines()
    ]
    assert result.exit_code == 7
    assert "Capturing source output completed." in events
    assert "Executing source succeeded." not in events


def _fail_capture(stream: str, data: bytes) -> None:
    assert stream and data
    raise OSError("capture unavailable")


def _assert_child_gone(pid_file: Path) -> None:
    with pytest.raises(ProcessLookupError):
        os.kill(int(pid_file.read_text()), 0)
