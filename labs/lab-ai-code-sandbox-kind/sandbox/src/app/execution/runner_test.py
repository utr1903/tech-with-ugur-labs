from __future__ import annotations

import os
import time
from dataclasses import replace
from pathlib import Path

import pytest

from app.config import Settings, load_settings
from app.execution.models import ExecutionStatus
from app.execution.runner import run_code
from app.execution.workspace import prepare_runs_root
from app.logging_setup import Logger


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return replace(
        load_settings({}),
        work_root=tmp_path,
        execution_timeout_seconds=2.0,
        max_output_bytes=1000,
        max_result_bytes=1000,
    )


@pytest.fixture
def runs_root(settings: Settings, log: Logger) -> Path:
    return prepare_runs_root(settings.work_root, log=log)


async def test_successful_program_returns_stdout(
    settings: Settings, runs_root: Path, log: Logger
) -> None:
    outcome = await run_code(
        "print('hello')", settings=settings, runs_root=runs_root, log=log
    )
    assert outcome.status is ExecutionStatus.SUCCEEDED
    assert outcome.exit_code == 0
    assert outcome.stdout == "hello\n"
    assert outcome.stderr == ""
    assert outcome.truncated is False
    assert outcome.duration_ms >= 0


async def test_exception_is_a_failed_run_with_traceback(
    settings: Settings, runs_root: Path, log: Logger
) -> None:
    outcome = await run_code(
        "raise ValueError('boom')", settings=settings, runs_root=runs_root, log=log
    )
    assert outcome.status is ExecutionStatus.FAILED
    assert outcome.exit_code == 1
    assert "Traceback" in outcome.stderr
    assert "ValueError: boom" in outcome.stderr


async def test_timeout_kills_the_program_and_its_children(
    settings: Settings, runs_root: Path, log: Logger
) -> None:
    code = (
        "import os, subprocess, sys\n"
        "child = subprocess.Popen(\n"
        "    [sys.executable, '-c', 'import time; time.sleep(600)']\n"
        ")\n"
        "print(os.getpid(), child.pid, flush=True)\n"
        "while True:\n    pass\n"
    )
    started = time.monotonic()
    outcome = await run_code(code, settings=settings, runs_root=runs_root, log=log)
    assert outcome.status is ExecutionStatus.TIMED_OUT
    assert outcome.exit_code is None
    assert time.monotonic() - started < settings.execution_timeout_seconds + 3
    parent_pid, child_pid = (int(p) for p in outcome.stdout.split())
    time.sleep(0.2)
    for pid in (parent_pid, child_pid):
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)


async def test_large_output_is_truncated(
    settings: Settings, runs_root: Path, log: Logger
) -> None:
    outcome = await run_code(
        "import sys; sys.stdout.write('x' * 50000)",
        settings=settings,
        runs_root=runs_root,
        log=log,
    )
    assert outcome.status is ExecutionStatus.SUCCEEDED
    assert outcome.truncated is True
    assert len(outcome.stdout) == settings.max_output_bytes


async def test_result_json_is_returned(
    settings: Settings, runs_root: Path, log: Logger
) -> None:
    code = "import json; json.dump({'answer': 42}, open('result.json', 'w'))"
    outcome = await run_code(code, settings=settings, runs_root=runs_root, log=log)
    assert outcome.result == {"answer": 42}
    assert outcome.result_error is None


async def test_invalid_result_json_is_reported(
    settings: Settings, runs_root: Path, log: Logger
) -> None:
    outcome = await run_code(
        "open('result.json', 'w').write('{nope')",
        settings=settings,
        runs_root=runs_root,
        log=log,
    )
    assert outcome.status is ExecutionStatus.SUCCEEDED
    assert outcome.result is None
    assert outcome.result_error == "result.json is not valid JSON"


async def test_working_directory_is_fresh_and_removed(
    settings: Settings, runs_root: Path, log: Logger
) -> None:
    first = await run_code(
        "import os; open('marker', 'w').write('x'); print(os.getcwd())",
        settings=settings,
        runs_root=runs_root,
        log=log,
    )
    earlier = first.stdout.strip()
    second = await run_code(
        f"import os; print(sorted(os.listdir('.')), os.path.exists({earlier!r}))",
        settings=settings,
        runs_root=runs_root,
        log=log,
    )
    assert second.stdout.strip() == "['main.py'] False"


async def test_environment_is_minimal(
    settings: Settings,
    runs_root: Path,
    log: Logger,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SANDBOX_TEST_SECRET", "canary-value")
    outcome = await run_code(
        "import os; print(sorted(os.environ))",
        settings=settings,
        runs_root=runs_root,
        log=log,
    )
    assert "SANDBOX_TEST_SECRET" not in outcome.stdout
    assert "canary-value" not in outcome.stdout


async def test_interpreter_state_is_not_shared(
    settings: Settings, runs_root: Path, log: Logger
) -> None:
    await run_code(
        "import builtins; builtins.SHARED = 1",
        settings=settings,
        runs_root=runs_root,
        log=log,
    )
    outcome = await run_code(
        "import builtins; print(hasattr(builtins, 'SHARED'))",
        settings=settings,
        runs_root=runs_root,
        log=log,
    )
    assert outcome.stdout == "False\n"
