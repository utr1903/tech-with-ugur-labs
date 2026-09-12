"""Real subprocess contract tests; Kubernetes supplies authoritative status."""

from __future__ import annotations

import time

import pytest

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
