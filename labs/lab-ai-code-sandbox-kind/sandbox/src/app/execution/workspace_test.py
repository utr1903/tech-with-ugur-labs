from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.execution.workspace import execution_directory, prepare_runs_root
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
