from __future__ import annotations

import httpx
import pytest

from app.errors import FetchError
from app.logging_setup import Logger, get_logger
from app.truth.fetch import fetch_json


@pytest.fixture
def log() -> Logger:
    return get_logger()


def _client(handler: httpx.MockTransport) -> httpx.Client:
    return httpx.Client(transport=handler, headers={"User-Agent": "lab test agent"})


def test_returns_parsed_json_and_sends_user_agent(log: Logger) -> None:
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["User-Agent"])
        return httpx.Response(200, json={"a": 1})

    with _client(httpx.MockTransport(handle)) as client:
        assert fetch_json(client, "https://example.test/x", log=log) == {"a": 1}
    assert seen == ["lab test agent"]


def test_non_200_raises_fetch_error(log: Logger) -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(403))

    with _client(transport) as client, pytest.raises(FetchError):
        fetch_json(client, "https://example.test/x", log=log)


def test_invalid_json_raises_fetch_error(log: Logger) -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, text="<html>"))

    with _client(transport) as client, pytest.raises(FetchError):
        fetch_json(client, "https://example.test/x", log=log)


def test_non_object_json_raises_fetch_error(log: Logger) -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=[1]))

    with _client(transport) as client, pytest.raises(FetchError):
        fetch_json(client, "https://example.test/x", log=log)
