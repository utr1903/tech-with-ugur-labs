from __future__ import annotations

from app.hermes.sse import parse_sse


def test_parse_sse_ignores_keepalive_and_closed() -> None:
    lines = [
        ": keepalive",
        "",
        "id: 1",
        'data: {"event": "message.delta", "seq": 1}',
        "",
        ": stream closed",
        "",
    ]
    assert list(parse_sse(lines)) == [{"event": "message.delta", "seq": 1}]


def test_parse_sse_multi_frames_one_chunk() -> None:
    chunk = 'data: {"seq": 1}\n\ndata: {"seq": 2}\n\n: keepalive\n\n'
    assert list(parse_sse([chunk])) == [{"seq": 1}, {"seq": 2}]


def test_parse_sse_flushes_unterminated_last_frame() -> None:
    assert list(parse_sse(['data: {"seq": 3}'])) == [{"seq": 3}]
