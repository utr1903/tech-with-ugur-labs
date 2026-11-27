from __future__ import annotations

import pytest

from app.errors import RunStoreError
from app.runs.record import RunRecord, record_from_json, record_to_json


def _record() -> RunRecord:
    return RunRecord(
        tool="ldr",
        question_id="q1-kev",
        run=2,
        started_at="2026-11-01T10:00:00Z",
        wall_seconds=123.5,
        status="completed",
        report="Findings.",
        sources=("https://a.example", "https://b.example"),
        usage={"input_tokens": 10, "output_tokens": 5},
        cost_usd=None,
        meta={"model": "qwen3.6-27b"},
    )


def test_round_trip() -> None:
    record = _record()

    assert record_from_json(record_to_json(record)) == record


def test_json_payload_uses_plain_lists() -> None:
    payload = record_to_json(_record())

    assert payload["sources"] == ["https://a.example", "https://b.example"]
    assert payload["cost_usd"] is None


def test_missing_key_raises() -> None:
    payload = record_to_json(_record())
    del payload["status"]

    with pytest.raises(RunStoreError, match="status"):
        record_from_json(payload)


def test_wrong_shape_raises() -> None:
    payload = record_to_json(_record())
    payload["sources"] = 5

    with pytest.raises(RunStoreError):
        record_from_json(payload)
