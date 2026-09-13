"""Inherited guest hard limits, independent of host PID accounting."""

from __future__ import annotations

import ctypes
import resource
import sys

PROCESS_LIMIT = 32
WALL_SECONDS = 10
SOURCE_BYTES = 16384
STREAM_BYTES = 8192


def harden_child() -> None:
    """Apply immutable child hard limits before executing attacker source."""
    resource.setrlimit(resource.RLIMIT_NPROC, (PROCESS_LIMIT, PROCESS_LIMIT))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16777216, 16777216))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    disable_dumpability()


def disable_dumpability() -> None:
    """Linux defense in depth; killing a same-UID supervisor remains possible."""
    if sys.platform == "linux":
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(4, 0, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "PR_SET_DUMPABLE failed")
