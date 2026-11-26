from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace

import pytest

from app.errors import GeminiError
from app.gemini.interactions import InteractionResult, run_interaction, to_result
from app.logging_setup import Logger, get_logger


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class FakeApi:
    """Replays scripted `get` replies; an Exception in the script is raised."""

    def __init__(self, *replies: object) -> None:
        self._replies: Iterator[object] = iter(replies)
        self.created: list[dict[str, object]] = []
        self.cancelled: list[str] = []
        self.polled: list[str] = []

    def create(self, *, agent: str, prompt: str, background: bool) -> object:
        self.created.append(
            {"agent": agent, "prompt": prompt, "background": background}
        )
        return _interaction("in_progress")

    def get(self, interaction_id: str, /) -> object:
        self.polled.append(interaction_id)
        reply = next(self._replies)
        if isinstance(reply, Exception):
            raise reply
        return reply

    def cancel(self, interaction_id: str, /) -> object:
        self.cancelled.append(interaction_id)
        return _interaction("cancelled")


def _text(text: str, *urls: str) -> SimpleNamespace:
    annotations = [SimpleNamespace(type="url_citation", url=u) for u in urls]
    return SimpleNamespace(type="text", text=text, annotations=annotations)


def _interaction(
    status: str,
    *,
    output_text: str | None = None,
    steps: list[SimpleNamespace] | None = None,
    usage: object = None,
    errors: list[object] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id="int-1",
        status=status,
        output_text=output_text,
        steps=steps,
        usage=usage,
        errors=errors,
    )


def _step(*content: SimpleNamespace, kind: str = "model_output") -> SimpleNamespace:
    return SimpleNamespace(type=kind, content=list(content))


@pytest.fixture
def log() -> Logger:
    return get_logger()


def _run(
    api: FakeApi, log: Logger, *, timeout: float = 600.0
) -> tuple[InteractionResult, float]:
    clock = FakeClock()
    return run_interaction(
        api,
        "the prompt",
        agent="agent-x",
        poll_seconds=15.0,
        timeout_seconds=timeout,
        clock=clock,
        sleep=clock.sleep,
        log=log,
    )


def test_polls_until_completed(log: Logger) -> None:
    api = FakeApi(
        _interaction("in_progress"),
        _interaction("queued"),
        _interaction("completed", output_text="the report"),
    )

    result, wall = _run(api, log)

    assert (result.status, result.report) == ("completed", "the report")
    assert wall == 30.0
    assert api.created == [
        {"agent": "agent-x", "prompt": "the prompt", "background": True}
    ]
    assert api.polled == ["int-1"] * 3
    assert api.cancelled == []


def test_empty_output_text_falls_back_to_last_model_output_step() -> None:
    interaction = _interaction(
        "completed",
        output_text="",
        steps=[
            _step(_text("draft"), kind="model_output"),
            _step(_text("thinking"), kind="thought"),
            _step(_text("part one "), _text("part two"), kind="model_output"),
        ],
    )

    assert to_result(interaction).report == "part one part two"


def test_citations_are_unique_and_ordered() -> None:
    interaction = _interaction(
        "completed",
        steps=[
            _step(_text("a", "https://x", "https://y"), _text("b", "https://x")),
        ],
    )

    assert to_result(interaction).citations == ("https://x", "https://y")


def test_usage_is_dumped_and_errors_are_described() -> None:
    usage = SimpleNamespace(model_dump=lambda mode: {"total_tokens": 7, "mode": mode})
    error = SimpleNamespace(code="X", message="boom")

    result = to_result(_interaction("failed", usage=usage, errors=[error]))

    assert result.usage == {"total_tokens": 7, "mode": "json"}
    assert result.errors == ("X: boom",)


def test_missing_usage_is_empty() -> None:
    assert to_result(_interaction("completed")).usage == {}


def test_timeout_cancels_the_interaction(log: Logger) -> None:
    api = FakeApi(*[_interaction("in_progress")] * 100)

    result, wall = _run(api, log, timeout=60.0)

    assert result.status == "timeout"
    assert result.id == "int-1"
    assert api.cancelled == ["int-1"]
    assert wall >= 60.0


def test_failed_status_is_returned_with_errors(log: Logger) -> None:
    api = FakeApi(_interaction("failed", errors=[SimpleNamespace(message="bad")]))

    result, _ = _run(api, log)

    assert result.status == "failed"
    assert result.errors == ("bad",)


def test_transient_poll_error_is_retried(log: Logger) -> None:
    api = FakeApi(GeminiError("blip"), _interaction("completed", output_text="ok"))

    result, _ = _run(api, log)

    assert result.status == "completed"


def test_five_consecutive_poll_errors_fail_the_run(log: Logger) -> None:
    api = FakeApi(*[GeminiError("down")] * 5)

    result, _ = _run(api, log)

    assert result.status == "failed"
    assert result.id == "int-1"
    assert "down" in result.errors[0]
    assert api.cancelled == ["int-1"]
