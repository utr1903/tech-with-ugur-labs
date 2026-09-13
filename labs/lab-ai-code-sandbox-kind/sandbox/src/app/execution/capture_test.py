from __future__ import annotations

import asyncio

from app.execution.capture import BoundedCapture


async def _feed(data: bytes) -> asyncio.StreamReader:
    reader = asyncio.StreamReader()
    reader.feed_data(data)
    reader.feed_eof()
    return reader


async def test_keeps_everything_under_the_limit() -> None:
    capture = BoundedCapture(limit=10)
    await capture.drain(await _feed(b"hello"))
    assert capture.snapshot().text == "hello"
    assert capture.snapshot().truncated is False


async def test_keeps_only_the_first_limit_bytes_and_flags_truncation() -> None:
    capture = BoundedCapture(limit=4)
    await capture.drain(await _feed(b"abcdefgh" * 100_000))
    assert capture.snapshot().text == "abcd"
    assert capture.snapshot().truncated is True


async def test_exactly_the_limit_is_not_truncated() -> None:
    capture = BoundedCapture(limit=3)
    await capture.drain(await _feed(b"abc"))
    assert capture.snapshot().truncated is False


async def test_invalid_utf8_is_replaced_not_raised() -> None:
    capture = BoundedCapture(limit=10)
    await capture.drain(await _feed(b"\xff\xfeok"))
    assert capture.snapshot().text.endswith("ok")


async def test_snapshot_is_available_while_the_stream_is_still_open() -> None:
    reader = asyncio.StreamReader()
    reader.feed_data(b"partial")
    capture = BoundedCapture(limit=100)
    task = asyncio.create_task(capture.drain(reader))
    await asyncio.sleep(0.05)
    assert capture.snapshot().text == "partial"
    task.cancel()
