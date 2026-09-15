"""Decode and validate standard wrapped Pub/Sub deliveries."""

from __future__ import annotations

import base64
import json
import math
from dataclasses import dataclass

from app.errors import MalformedMessageError


@dataclass(frozen=True)
class Delivery:
    """The application fields extracted from one Pub/Sub delivery."""

    message_id: str
    number: int | float


def _required_string(mapping: object, field: str) -> str:
    if not isinstance(mapping, dict):
        raise MalformedMessageError("expected an object")
    value: object = mapping.get(field)
    if not isinstance(value, str) or not value:
        raise MalformedMessageError(f"{field} must be a non-empty string")
    return value


def _reject_json_constant(constant: str) -> object:
    raise MalformedMessageError(f"unsupported JSON number {constant}")


def _decode_data(encoded_data: str) -> object:
    try:
        decoded_bytes = base64.b64decode(encoded_data, validate=True)
        return json.loads(
            decoded_bytes.decode("utf-8"),
            parse_constant=_reject_json_constant,
        )
    except (ValueError, RecursionError) as err:
        raise MalformedMessageError("message data is not base64 JSON") from err


def _finite_javascript_number(payload: object) -> int | float:
    if not isinstance(payload, dict):
        raise MalformedMessageError("message data must be an object")
    number: object = payload.get("number")
    if isinstance(number, bool) or not isinstance(number, (int, float)):
        raise MalformedMessageError("number must be numeric")
    try:
        javascript_number = float(number)
    except OverflowError as err:
        raise MalformedMessageError(
            "number exceeds the JavaScript finite range"
        ) from err
    if not math.isfinite(javascript_number):
        raise MalformedMessageError("number must be finite")
    return number


def parse_delivery(payload: object) -> Delivery:
    """Returns validated application data from a wrapped push request."""
    if not isinstance(payload, dict):
        raise MalformedMessageError("delivery must be an object")
    message: object = payload.get("message")
    encoded_data = _required_string(message, "data")
    message_id = _required_string(message, "messageId")
    number = _finite_javascript_number(_decode_data(encoded_data))
    return Delivery(message_id=message_id, number=number)


def number_text(number: int | float) -> str:
    """Serializes a finite number as standalone JSON text."""
    return json.dumps(number, allow_nan=False, separators=(",", ":"))
