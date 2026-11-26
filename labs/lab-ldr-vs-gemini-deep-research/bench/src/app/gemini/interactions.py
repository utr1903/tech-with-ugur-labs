"""Running one Gemini Deep Research interaction and reading its result."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

from app.errors import GeminiError
from app.logging_setup import Logger

_RUNNING = ("in_progress", "queued")
_MAX_POLL_FAILURES = 5


class InteractionsApi(Protocol):
    """The three Interactions calls this lab uses; replies stay opaque."""

    def create(self, *, agent: str, prompt: str, background: bool) -> object:
        """Starts an interaction."""
        ...

    def get(self, interaction_id: str, /) -> object:
        """Fetches the interaction's current state."""
        ...

    def cancel(self, interaction_id: str, /) -> object:
        """Asks the service to stop the interaction."""
        ...


@dataclass(frozen=True)
class InteractionResult:
    """An interaction reduced to what the benchmark records."""

    id: str
    status: str
    report: str
    citations: tuple[str, ...]
    usage: Mapping[str, object]
    errors: tuple[str, ...]


def to_result(interaction: object) -> InteractionResult:
    """Reads the SDK's interaction object; the only place its shape is known."""
    texts = _last_output_texts(interaction)
    report = getattr(interaction, "output_text", None) or "".join(
        getattr(t, "text", "") or "" for t in texts
    )
    urls = (
        getattr(a, "url", None)
        for t in texts
        for a in getattr(t, "annotations", None) or []
        if getattr(a, "type", None) == "url_citation"
    )
    return InteractionResult(
        id=str(getattr(interaction, "id", "")),
        status=str(getattr(interaction, "status", "")),
        report=str(report),
        citations=tuple(dict.fromkeys(str(u) for u in urls if u)),
        usage=_usage(getattr(interaction, "usage", None)),
        errors=tuple(_describe(e) for e in getattr(interaction, "errors", None) or []),
    )


def _last_output_texts(interaction: object) -> list[object]:
    steps = getattr(interaction, "steps", None) or []
    outputs = [s for s in steps if getattr(s, "type", None) == "model_output"]
    if not outputs:
        return []
    content = getattr(outputs[-1], "content", None) or []
    return [c for c in content if getattr(c, "type", None) == "text"]


def _usage(usage: object) -> Mapping[str, object]:
    dump = getattr(usage, "model_dump", None)
    if not callable(dump):
        return {}
    dumped = dump(mode="json")
    return dict(dumped) if isinstance(dumped, dict) else {}


def _describe(error: object) -> str:
    code = getattr(error, "code", None)
    message = getattr(error, "message", None) or str(error)
    return f"{code}: {message}" if code else str(message)


def run_interaction(
    api: InteractionsApi,
    prompt: str,
    *,
    agent: str,
    poll_seconds: float,
    timeout_seconds: float,
    clock: Callable[[], float],
    sleep: Callable[[float], None],
    log: Logger,
) -> tuple[InteractionResult, float]:
    """Starts the agent and polls to a final state; returns it with wall seconds.

    Only a failure to start raises. A timeout or repeated poll failure cancels
    the interaction and returns a `timeout` or `failed` result.
    """
    began = clock()
    try:
        log.info("Starting interaction...", agent=agent, prompt_chars=len(prompt))
        interaction_id = to_result(
            api.create(agent=agent, prompt=prompt, background=True)
        ).id
    except GeminiError:
        log.exception("Starting interaction failed.", agent=agent)
        raise
    else:
        log.info("Starting interaction succeeded.", interaction_id=interaction_id)
    log = log.bind(interaction_id=interaction_id)
    result = _poll(
        api,
        interaction_id,
        deadline=began + timeout_seconds,
        poll_seconds=poll_seconds,
        clock=clock,
        sleep=sleep,
        log=log,
    )
    return result, clock() - began


def _poll(
    api: InteractionsApi,
    interaction_id: str,
    *,
    deadline: float,
    poll_seconds: float,
    clock: Callable[[], float],
    sleep: Callable[[float], None],
    log: Logger,
) -> InteractionResult:
    failures = 0
    log.info("Waiting for interaction...")
    while True:
        try:
            result = to_result(api.get(interaction_id))
        except GeminiError as err:
            failures += 1
            log.warning("Status poll failed.", failures=failures, error=str(err))
            if failures >= _MAX_POLL_FAILURES:
                _cancel(api, interaction_id, log=log)
                return _stopped(interaction_id, "failed", str(err))
        else:
            failures = 0
            if result.status not in _RUNNING:
                log.info("Waiting for interaction succeeded.", status=result.status)
                return result
        if clock() >= deadline:
            log.warning("Interaction timed out.")
            _cancel(api, interaction_id, log=log)
            return _stopped(interaction_id, "timeout", "timed out")
        sleep(poll_seconds)


def _stopped(interaction_id: str, status: str, reason: str) -> InteractionResult:
    return InteractionResult(
        id=interaction_id,
        status=status,
        report="",
        citations=(),
        usage={},
        errors=(reason,),
    )


def _cancel(api: InteractionsApi, interaction_id: str, *, log: Logger) -> None:
    """Best-effort stop of an interaction that must not keep running."""
    try:
        log.info("Cancelling interaction...")
        api.cancel(interaction_id)
    except GeminiError:
        log.exception("Cancelling interaction failed.")
    else:
        log.info("Cancelling interaction succeeded.")
