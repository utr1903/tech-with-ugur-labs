"""Reads the optional result.json a program leaves in its working directory."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

from app.execution.models import ResultFile

RESULT_FILE_NAME = "result.json"


def _reject_constant(name: str) -> object:
    raise ValueError(f"non-finite number {name}")


def read_result_file(workdir: Path, *, limit: int) -> ResultFile:
    """Parses result.json without following symlinks or blocking on FIFOs.

    Error messages never quote the file's content: it is untrusted output.
    """
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    try:
        fd = os.open(workdir / RESULT_FILE_NAME, flags)
    except FileNotFoundError:
        return ResultFile(value=None, error=None)
    except OSError:
        return ResultFile(
            value=None,
            error="result.json could not be opened (symlinks are rejected)",
        )
    with os.fdopen(fd, "rb") as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            return ResultFile(value=None, error="result.json is not a regular file")
        data = handle.read(limit + 1)
    if len(data) > limit:
        return ResultFile(value=None, error=f"result.json is larger than {limit} bytes")
    try:
        value = json.loads(data.decode("utf-8"), parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        # RecursionError: json's recursive-descent parser blows the Python
        # call stack on deeply nested input (e.g. thousands of "[") well
        # under `limit` bytes; that is a malformed submission, not a crash.
        return ResultFile(value=None, error="result.json is not valid JSON")
    return ResultFile(value=value, error=None)
