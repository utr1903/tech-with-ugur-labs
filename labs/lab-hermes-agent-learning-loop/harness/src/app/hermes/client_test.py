from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from app.errors import HermesError
from app.hermes.client import HermesClient
from app.logging_setup import get_logger


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> HermesClient:
    return HermesClient(
        "http://hermes:8642",
        "secret-key",
        transport=httpx.MockTransport(handler),
        log=get_logger(),
    )


def _frame(seq: int, event: str, **extra: object) -> str:
    payload = {"event": event, "run_id": "r1", "timestamp": 1.0, "seq": seq, **extra}
    return f"id: {seq}\ndata: {json.dumps(payload)}\n\n"


def _sse(*frames: str) -> httpx.Response:
    body = "".join(frames) + ": stream closed\n\n"
    return httpx.Response(
        200, content=body.encode(), headers={"content-type": "text/event-stream"}
    )


def test_health_sends_no_auth() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"status": "ok", "version": "0.23.4"})

    assert _client(handler).health()["status"] == "ok"
    assert "authorization" not in seen[0].headers


def test_start_run_sends_bearer_and_session() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(202, json={"run_id": "run_1", "status": "started"})

    client = _client(handler)
    assert client.start_run("hello", session_id="run_0") == "run_1"
    assert client.start_run("again") == "run_1"
    assert seen[0].headers["authorization"] == "Bearer secret-key"
    assert json.loads(seen[0].content) == {"input": "hello", "session_id": "run_0"}
    assert json.loads(seen[1].content) == {"input": "again"}


def test_http_error_raises_hermes_error() -> None:
    client = _client(lambda _r: httpx.Response(401, text="nope"))
    with pytest.raises(HermesError, match="401"):
        client.start_run("x")


def test_stream_until_completed() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return _sse(
            _frame(1, "tool.started", tool="terminal", tool_call_id="t1"),
            _frame(
                2, "tool.completed", tool="terminal", tool_call_id="t1", error=False
            ),
            _frame(3, "run.completed", output="done"),
            _frame(4, "message.delta", delta="never seen"),
        )

    events = list(_client(handler).stream_events("r1", timeout_s=30))
    assert [e.event for e in events] == [
        "tool.started",
        "tool.completed",
        "run.completed",
    ]
    assert events[-1].data["output"] == "done"


def test_stream_resumes_without_duplicates() -> None:
    queries: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        queries.append(request.url.query.decode())
        if len(queries) == 1:
            raise httpx.RemoteProtocolError("peer closed", request=request)
        if len(queries) == 2:
            return _sse(
                _frame(1, "message.delta", delta="a"), _frame(2, "message.delta")
            )
        # Replays an already-seen event; it must be dropped.
        return _sse(_frame(2, "message.delta"), _frame(3, "run.completed", output="x"))

    # Second response ends without a terminal event: stream must reconnect.
    events = list(_client(handler).stream_events("r1", timeout_s=30))
    assert [e.seq for e in events] == [1, 2, 3]
    assert queries == ["", "", "last_seq=2"]


def test_stream_gives_up_after_five_reconnects() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(HermesError, match="reconnect"):
        list(_client(handler).stream_events("r1", timeout_s=30))


def test_stream_deadline_raises() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return _sse(_frame(1, "message.delta", delta="a"))

    with pytest.raises(HermesError, match="deadline"):
        list(_client(handler).stream_events("r1", timeout_s=0))


def test_sessions_children_parsed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["include_children"] == "true"
        assert request.url.params["limit"] == "200"
        row = {"model": "m", "input_tokens": 5, "output_tokens": 2, "extra": 1}
        return httpx.Response(
            200,
            json={
                "object": "list",
                "data": [
                    {
                        **row,
                        "id": "r1",
                        "source": "api_server",
                        "parent_session_id": None,
                        "tool_call_count": 3,
                    },
                    {
                        **row,
                        "id": "s2",
                        "source": "subagent",
                        "parent_session_id": "r1",
                        "tool_call_count": 1,
                    },
                ],
            },
        )

    rows = _client(handler).sessions()
    assert [(r.id, r.source, r.parent_session_id) for r in rows] == [
        ("r1", "api_server", None),
        ("s2", "subagent", "r1"),
    ]
    assert rows[0].tool_call_count == 3
    assert rows[1].input_tokens == 5


def test_messages_returns_data() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/sessions/r1/messages"
        return httpx.Response(200, json={"data": [{"id": 1, "role": "user"}]})

    assert _client(handler).messages("r1") == [{"id": 1, "role": "user"}]
