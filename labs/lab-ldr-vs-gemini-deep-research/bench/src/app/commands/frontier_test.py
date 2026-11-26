from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.commands import frontier
from app.errors import ConfigError
from app.logging_setup import Logger, get_logger
from app.runs.store import load_runs, run_path

_TODAY = date(2026, 11, 20)


class FakeUsage:
    def model_dump(self, mode: str) -> dict[str, object]:
        return {
            "mode": mode,
            "total_input_tokens": 100_000,
            "total_cached_tokens": 0,
            "total_output_tokens": 10_000,
            "total_thought_tokens": 0,
        }


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class FakeApi:
    def __init__(self, status: str = "completed") -> None:
        self.status = status
        self.prompts: list[str] = []
        self.agents: list[tuple[str, bool]] = []

    def create(self, *, agent: str, prompt: str, background: bool) -> object:
        self.prompts.append(prompt)
        self.agents.append((agent, background))
        return SimpleNamespace(id=f"int-{len(self.prompts)}", status="in_progress")

    def get(self, interaction_id: str, /) -> object:
        text = SimpleNamespace(
            type="text",
            text="the report",
            annotations=[SimpleNamespace(type="url_citation", url="https://a")],
        )
        return SimpleNamespace(
            id=interaction_id,
            status=self.status,
            output_text="",
            steps=[SimpleNamespace(type="model_output", content=[text])],
            usage=FakeUsage(),
            errors=[],
        )

    def cancel(self, interaction_id: str, /) -> object:
        return SimpleNamespace(id=interaction_id, status="cancelled")


@pytest.fixture
def log() -> Logger:
    return get_logger()


@pytest.fixture(autouse=True)
def env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "key")
    monkeypatch.setenv("RESULTS_DIR", str(tmp_path))


def _args(question: str = "q1-kev", runs: int = 1) -> argparse.Namespace:
    return argparse.Namespace(
        command="frontier", question=question, runs=runs, overwrite=False
    )


def _run(args: argparse.Namespace, log: Logger, api: FakeApi) -> None:
    clock = FakeClock()
    frontier.run(args, log=log, today=_TODAY, clock=clock, sleep=clock.sleep, api=api)


def test_completed_run_is_saved_with_cost_and_meta(tmp_path: Path, log: Logger) -> None:
    _run(_args(), log, FakeApi())

    (record,) = load_runs(tmp_path, log=log)
    assert (record.tool, record.status, record.report) == (
        "gemini",
        "completed",
        "the report",
    )
    assert record.sources == ("https://a",)
    assert record.cost_usd == pytest.approx(0.2 + 0.12)
    assert record.usage["total_output_tokens"] == 10_000
    assert record.meta["interaction_id"] == "int-1"
    assert record.meta["api_version"] == "v1beta"
    assert {"agent", "sdk_version"} <= set(record.meta)


def test_non_completed_status_is_recorded_as_failed(
    tmp_path: Path, log: Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    _run(_args(runs=2), log, FakeApi("incomplete"))

    records = load_runs(tmp_path, log=log)
    assert [(r.run, r.status, r.meta["gemini_status"]) for r in records] == [
        (1, "failed", "incomplete"),
        (2, "failed", "incomplete"),
    ]
    assert "q1-kev run 2: failed" in capsys.readouterr().out


def test_resumes_at_next_free_run_number(tmp_path: Path, log: Logger) -> None:
    _run(_args(), log, FakeApi())

    _run(_args(), log, FakeApi())

    assert run_path(tmp_path, "gemini", "q1-kev", 2).exists()


def test_all_questions_get_the_dated_prompt(log: Logger) -> None:
    api = FakeApi()

    _run(_args("all"), log, api)

    assert len(api.prompts) == 2
    assert api.agents == [("deep-research-preview-04-2026", True)] * 2
    assert all("2026-11-20" in prompt for prompt in api.prompts)


def test_missing_key_is_config_error(
    monkeypatch: pytest.MonkeyPatch, log: Logger
) -> None:
    monkeypatch.delenv("GEMINI_API_KEY")

    with pytest.raises(ConfigError, match="make score"):
        _run(_args(), log, FakeApi())
