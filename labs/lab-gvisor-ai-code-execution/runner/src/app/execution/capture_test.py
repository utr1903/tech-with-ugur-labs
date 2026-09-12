"""Protocol budgets and early output survive a later supervisor failure."""

from __future__ import annotations

import json

from pytest import CaptureFixture

from app.execution.capture import StreamCapture


def test_first_partial_chunk_is_flushed_immediately(
    capsys: CaptureFixture[str],
) -> None:
    capture = StreamCapture("stdout")
    capture.accept(b"marker\n")
    records = capsys.readouterr().out.splitlines()
    assert len(records) == 1
    assert json.loads(records[0])["dataB64"] == "bWFya2VyCg=="


def test_tiny_writes_do_not_generate_unbounded_frames(
    capsys: CaptureFixture[str],
) -> None:
    capture = StreamCapture("stderr")
    for _ in range(100000):
        capture.accept(b"x")
    capture.flush()
    records = capsys.readouterr().out.splitlines()
    assert len(records) <= 9
    assert len(capture.data) == 8192
    assert capture.truncated
    assert sum(len(record) + 1 for record in records) < 14000
