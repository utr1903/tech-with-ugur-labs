"""Validates a POST /execute body without echoing untrusted input."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.errors import LabError


class InvalidRequestError(LabError):
    """The request body is not an acceptable execute request."""


class _ExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    code: str = Field(min_length=1)


def parse_execute_body(body: bytes, *, max_code_bytes: int) -> str:
    """Returns the submitted code or raises InvalidRequestError."""
    try:
        request = _ExecuteRequest.model_validate_json(body)
    except ValidationError as err:
        problems = sorted(
            {
                f"{'.'.join(map(str, e['loc'])) or 'body'}: {e['type']}"
                for e in err.errors()
            }
        )
        raise InvalidRequestError(
            f'body must be {{"code": "<non-empty string>"}} ({"; ".join(problems)})'
        ) from err
    if len(request.code.encode("utf-8")) > max_code_bytes:
        raise InvalidRequestError(f"code must be at most {max_code_bytes} bytes")
    return request.code
