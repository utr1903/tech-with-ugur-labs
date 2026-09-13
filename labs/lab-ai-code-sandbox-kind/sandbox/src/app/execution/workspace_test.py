from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.execution.workspace import (
    _unlock_and_retry,
    execution_directory,
    prepare_runs_root,
)
from app.logging_setup import Logger


def test_runs_root_cannot_be_listed_but_accepts_new_directories(
    tmp_path: Path, log: Logger
) -> None:
    runs = prepare_runs_root(tmp_path, log=log)
    assert runs == tmp_path / "runs"
    assert (runs.stat().st_mode & 0o777) == 0o300
    with execution_directory(runs, log=log) as workdir:
        assert workdir.parent == runs
        (workdir / "main.py").write_text("print(1)")
    if os.geteuid() != 0:
        with pytest.raises(PermissionError):
            list(runs.iterdir())


def test_directory_is_removed_after_use(tmp_path: Path, log: Logger) -> None:
    runs = prepare_runs_root(tmp_path, log=log)
    with execution_directory(runs, log=log) as workdir:
        (workdir / "nested").mkdir()
        (workdir / "nested" / "f.txt").write_text("x")
        seen = workdir
    assert not seen.exists()


def test_directory_is_removed_even_if_the_program_locked_it_down(
    tmp_path: Path, log: Logger
) -> None:
    runs = prepare_runs_root(tmp_path, log=log)
    with execution_directory(runs, log=log) as workdir:
        locked = workdir / "locked"
        locked.mkdir()
        (locked / "f.txt").write_text("x")
        locked.chmod(0o000)
        seen = workdir
    assert not seen.exists()


def test_prepare_is_idempotent(tmp_path: Path, log: Logger) -> None:
    prepare_runs_root(tmp_path, log=log)
    assert prepare_runs_root(tmp_path, log=log) == tmp_path / "runs"


def _unsupported_step(_path: str) -> object:
    raise AssertionError("must not be called: not a retryable rmtree step")


def test_unlock_and_retry_reraises_the_original_error_for_unsupported_steps(
    tmp_path: Path,
) -> None:
    # rmtree's fd-safe walk can hand this handler something like `os.open`
    # or `os.scandir` for a step that needs more than a bare path; retrying
    # any of those as `func(path)` raises an unrelated TypeError that would
    # replace the real failure. Only os.unlink/os.rmdir are ever retried;
    # anything else (modeled here by a stand-in that fails the test if it
    # is ever invoked) must re-raise the original error untouched instead.
    original = OSError("simulated failure")
    with pytest.raises(OSError) as exc_info:
        _unlock_and_retry(_unsupported_step, str(tmp_path), original)
    assert exc_info.value is original


def test_removal_survives_a_relocked_directory_even_without_the_pre_walk(
    tmp_path: Path, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Disabling the proactive walk simulates something re-locking the tree
    # between it and rmtree (e.g. a setsid'd descendant that survived
    # killpg): rmtree must then hit the locked subdirectory for real and
    # go through `_unlock_and_retry`, which must not escape `_remove` with
    # anything other than the original OSError -- an escaped exception here
    # would replace an already-computed execution outcome with a crash.
    monkeypatch.setattr("app.execution.workspace._unlock_tree", lambda _path: None)
    runs = prepare_runs_root(tmp_path, log=log)
    with execution_directory(runs, log=log) as workdir:
        locked = workdir / "locked"
        locked.mkdir()
        (locked / "f.txt").write_text("x")
        locked.chmod(0o000)
    # No exception escaped the `with` block above: `_remove` swallowed
    # whatever rmtree raised and logged a warning instead, per its own
    # contract. That is the behaviour under test; whether the leftover
    # directory itself was actually removed is incidental here.
