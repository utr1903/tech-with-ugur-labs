"""Per-execution working directories under a runs root with listing turned off."""

from __future__ import annotations

import os
import shutil
import tempfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

from app.logging_setup import Logger

_RUNS_DIR = "runs"
# Owner may create and enter entries but not list them. That keeps a casual
# os.listdir("..") from listing other runs' directories, but it is not a
# boundary against code that tries: submitted code runs as the UID that owns
# this directory, so it can chmod it back and list it, and it can find other
# runs through /proc/<pid>/cwd.
_RUNS_MODE = 0o300


def prepare_runs_root(work_root: Path, *, log: Logger) -> Path:
    """Creates `<work_root>/runs` with write+execute-only permissions."""
    runs = work_root / _RUNS_DIR
    try:
        log.info("Preparing runs root...", path=str(runs))
        runs.mkdir(mode=0o700, parents=True, exist_ok=True)
        runs.chmod(_RUNS_MODE)
    except OSError:
        log.exception("Preparing runs root failed.", path=str(runs))
        raise
    else:
        log.info("Preparing runs root succeeded.", path=str(runs))
        return runs


_RETRYABLE_STEPS = (os.unlink, os.rmdir)


def _unlock_and_retry(
    func: Callable[[str], object], path: str, exc: BaseException
) -> None:
    """Retries one rmtree step after chmod-ing its target back to 0700.

    `func` is whatever rmtree's fd-safe walk was doing when it hit an
    OSError -- for a locked directory that can be `os.open` or
    `os.scandir`, which need more than a bare path and would raise their
    own unrelated TypeError if called as `func(path)`. Only `os.unlink`
    and `os.rmdir` are ever safe to retry that way, so anything else
    re-raises the original OSError unchanged: this handler must never
    replace it with a different exception, or a finished execution's
    result would be lost to a cleanup-time crash instead of the warning
    below.
    """
    if func not in _RETRYABLE_STEPS:
        raise exc
    Path(path).parent.chmod(0o700)
    if Path(path).is_dir() and not Path(path).is_symlink():
        Path(path).chmod(0o700)
    func(path)


def _unlock_tree(path: Path) -> None:
    # macOS's rmtree needs to list a directory before it can report that
    # listing failed, so a subdirectory chmod-ed to 000 by the submitted
    # program must be unlocked before rmtree ever walks into it, not only
    # when rmtree's own error handler fires on it.
    for root, dirs, _files in os.walk(path, onerror=lambda _err: None):
        Path(root).chmod(0o700)
        for name in dirs:
            child = Path(root) / name
            if not child.is_symlink():
                child.chmod(0o700)


@contextmanager
def execution_directory(runs_root: Path, *, log: Logger) -> Iterator[Path]:
    """Yields a fresh private directory and removes it afterwards."""
    path = Path(tempfile.mkdtemp(prefix="run-", dir=runs_root))
    try:
        yield path
    finally:
        _remove(path, log=log)


def _remove(path: Path, *, log: Logger) -> None:
    try:
        path.chmod(0o700)
        _unlock_tree(path)
        shutil.rmtree(path, onexc=_unlock_and_retry)
    except OSError:
        # The response is already computed; a leftover directory is a disk
        # leak inside the runs root, not a correctness problem.
        log.warning(
            "Removing execution directory failed.", path=path.name, exc_info=True
        )
