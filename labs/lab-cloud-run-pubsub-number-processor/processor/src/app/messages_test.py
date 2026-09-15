"""Behavior tests for wrapped Pub/Sub message decoding."""

from __future__ import annotations

import base64
import json

import pytest

from app.errors import MalformedMessageError
from app.messages import Delivery, parse_delivery


def envelope(inner_json: str, *, message_id: object = "message-123") -> object:
    """Builds a complete Pub/Sub push envelope around literal message data."""
    data = base64.b64encode(inner_json.encode()).decode()
    return {"message": {"data": data, "messageId": message_id}}


def test_decodes_a_finite_number_and_message_id() -> None:
    parsed = parse_delivery(envelope('{"number":101}'))

    assert parsed == Delivery(message_id="message-123", number=101)


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {},
        {"message": None},
        {"message": {}},
        {"message": {"messageId": "message-123", "data": "%%%"}},
        envelope("{"),
        envelope("null"),
        envelope("[]"),
        envelope("{}"),
        envelope('{"number":null}'),
        envelope('{"number":true}'),
        envelope('{"number":"101"}'),
        envelope('{"number":[]}'),
        envelope('{"number":NaN}'),
        envelope('{"number":Infinity}'),
        envelope('{"number":1e999}'),
        envelope('{"number":9007199254740993}'),
        envelope(json.dumps({"number": 10**309})),
        envelope('{"number":101}', message_id=None),
        envelope('{"number":101}', message_id=""),
    ],
)
def test_rejects_malformed_or_nonfinite_deliveries(payload: object) -> None:
    with pytest.raises(MalformedMessageError):
        parse_delivery(payload)
