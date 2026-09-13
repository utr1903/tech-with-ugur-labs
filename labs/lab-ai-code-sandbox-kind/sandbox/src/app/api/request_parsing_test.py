from __future__ import annotations

import json

import pytest

from app.api.request_parsing import InvalidRequestError, parse_execute_body


def test_accepts_code() -> None:
    assert parse_execute_body(b'{"code": "print(1)"}', max_code_bytes=100) == "print(1)"


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        b"{}",
        b'{"code": ""}',
        b'{"code": 5}',
        b'{"code": "x", "extra": 1}',
        b"[]",
    ],
)
def test_rejects_malformed_bodies(body: bytes) -> None:
    with pytest.raises(InvalidRequestError):
        parse_execute_body(body, max_code_bytes=100)


def test_rejects_code_over_the_byte_limit_counting_utf8() -> None:
    body = json.dumps({"code": "é" * 60}).encode()  # 120 bytes of UTF-8
    with pytest.raises(InvalidRequestError, match="100 bytes"):
        parse_execute_body(body, max_code_bytes=100)


def test_error_message_never_echoes_the_submitted_code() -> None:
    with pytest.raises(InvalidRequestError) as info:
        parse_execute_body(b'{"code": "SECRET-CANARY", "extra": 1}', max_code_bytes=100)
    assert "SECRET-CANARY" not in str(info.value)
