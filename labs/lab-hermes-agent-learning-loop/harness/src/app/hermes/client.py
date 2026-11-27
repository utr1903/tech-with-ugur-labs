"""HTTP client for the Hermes Agent API server (runs, sessions, messages)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Protocol

import httpx

from app.errors import HermesError
from app.hermes.models import RunEvent, SessionRow
from app.hermes.runs import BODY_CHARS, stream_run_events
from app.logging_setup import Logger

__all__ = ["HermesApi", "HermesClient", "RunEvent", "SessionRow"]

_TIMEOUT = httpx.Timeout(120.0, connect=10.0)


class HermesApi(Protocol):
    """What the matrix runner needs from Hermes; tests substitute a fake."""

    def health(self) -> dict[str, object]: ...

    def start_run(self, input_text: str, *, session_id: str | None = None) -> str: ...

    def stream_events(self, run_id: str, *, timeout_s: float) -> Iterator[RunEvent]: ...

    def sessions(
        self, *, include_children: bool = True, limit: int = 200
    ) -> list[SessionRow]: ...

    def messages(self, session_id: str) -> list[dict[str, object]]: ...


class HermesClient:
    """Talks to one Hermes API server. The API key is never logged."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        transport: httpx.BaseTransport | None = None,
        log: Logger,
    ) -> None:
        self._http = httpx.Client(
            base_url=base_url, timeout=_TIMEOUT, transport=transport
        )
        self._auth = {"Authorization": f"Bearer {api_key}"}
        self._log = log

    def health(self) -> dict[str, object]:
        """Returns the unauthenticated health document."""
        return self._json("GET", "/health", auth=False)

    def start_run(self, input_text: str, *, session_id: str | None = None) -> str:
        """Starts a run, continuing `session_id` when given; returns its id."""
        body: dict[str, object] = {"input": input_text}
        if session_id is not None:
            body["session_id"] = session_id
        run_id = self._json("POST", "/v1/runs", json=body).get("run_id")
        if not isinstance(run_id, str):
            raise HermesError("POST /v1/runs returned no run_id.")
        self._log.info("Run started.", run_id=run_id, session_id=session_id)
        return run_id

    def stream_events(self, run_id: str, *, timeout_s: float) -> Iterator[RunEvent]:
        """Yields the run's events until it reaches a terminal state."""
        return stream_run_events(
            self._http, self._auth, run_id, timeout_s=timeout_s, log=self._log
        )

    def sessions(
        self, *, include_children: bool = True, limit: int = 200
    ) -> list[SessionRow]:
        """Lists sessions, subagent children included by default."""
        params: dict[str, str | int] = {
            "include_children": str(include_children).lower(),
            "limit": limit,
        }
        rows = self._json("GET", "/api/sessions", params=params).get("data")
        return [_session_row(row) for row in _list_of_dicts(rows, "/api/sessions")]

    def messages(self, session_id: str) -> list[dict[str, object]]:
        """Returns a session's stored messages, tool calls included."""
        route = f"/api/sessions/{session_id}/messages"
        return _list_of_dicts(self._json("GET", route).get("data"), route)

    def _json(
        self,
        method: str,
        route: str,
        *,
        auth: bool = True,
        params: dict[str, str | int] | None = None,
        json: dict[str, object] | None = None,
    ) -> dict[str, object]:
        headers = self._auth if auth else {}
        try:
            response = self._http.request(
                method, route, headers=headers, params=params, json=json
            )
        except httpx.HTTPError as err:
            raise HermesError(f"{method} {route} failed: {type(err).__name__}") from err
        if response.status_code >= 300:
            raise HermesError(
                f"{method} {route} returned {response.status_code}: "
                f"{response.text[:BODY_CHARS]}"
            )
        try:
            body = response.json()
        except ValueError as err:
            raise HermesError(f"{method} {route} returned malformed JSON.") from err
        if not isinstance(body, dict):
            raise HermesError(f"{method} {route} returned a non-object body.")
        return body


def _list_of_dicts(value: object, route: str) -> list[dict[str, object]]:
    if not isinstance(value, list) or not all(isinstance(v, dict) for v in value):
        raise HermesError(f"{route} returned no `data` list.")
    return value


def _session_row(row: dict[str, object]) -> SessionRow:
    parent = row.get("parent_session_id")
    if "id" not in row:
        raise HermesError("/api/sessions returned a row without an id.")
    return SessionRow(
        id=str(row["id"]),
        source=str(row.get("source", "")),
        parent_session_id=parent if isinstance(parent, str) else None,
        model=str(row.get("model") or ""),
        input_tokens=_int(row.get("input_tokens")),
        output_tokens=_int(row.get("output_tokens")),
        tool_call_count=_int(row.get("tool_call_count")),
    )


def _int(value: object) -> int:
    return value if isinstance(value, int) else 0
