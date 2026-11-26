from __future__ import annotations

import argparse
from collections.abc import Callable
from datetime import date
from pathlib import Path

import httpx
import pytest

from app.commands import research
from app.errors import ConfigError
from app.logging_setup import Logger, get_logger
from app.runs.record import RunRecord
from app.runs.store import load_runs, run_path, save_run

_TODAY = date(2026, 11, 20)

type Handler = Callable[[httpx.Request], httpx.Response]


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def log() -> Logger:
    return get_logger()


@pytest.fixture(autouse=True)
def env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LDR_LAB_PASSWORD", "pw")
    monkeypatch.setenv("RESULTS_DIR", str(tmp_path))
    monkeypatch.setenv("LDR_POLL_SECONDS", "10")


def _args(
    question: str = "all", runs: int = 2, *, overwrite: bool = False
) -> argparse.Namespace:
    return argparse.Namespace(
        command="research", question=question, runs=runs, overwrite=overwrite
    )


def _service(final_status: str = "completed") -> Handler:
    started: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path in ("/auth/login", "/auth/register") and request.method == "GET":
            return httpx.Response(200, text='<input name="csrf_token" value="t">')
        if path == "/auth/login":
            return httpx.Response(302, headers={"location": "/"})
        if path == "/auth/csrf-token":
            return httpx.Response(200, json={"csrf_token": "api"})
        if path == "/api/start_research":
            started.append("x")
            return httpx.Response(
                200, json={"status": "success", "research_id": f"r{len(started)}"}
            )
        if path.endswith("/status"):
            return httpx.Response(200, json={"status": final_status})
        if path.startswith("/api/report/"):
            return httpx.Response(
                200,
                json={"content": "body", "sources": [{"url": "https://a"}]},
            )
        return httpx.Response(200, json={"metadata": {"duration": 5}})

    return handler


def _run(args: argparse.Namespace, log: Logger, handler: Handler) -> None:
    clock = FakeClock()
    research.run(
        args,
        log=log,
        today=_TODAY,
        clock=clock,
        sleep=clock.sleep,
        transport=httpx.MockTransport(handler),
    )


def _existing(results: Path, qid: str, run: int, log: Logger) -> None:
    record = RunRecord(
        tool="ldr",
        question_id=qid,
        run=run,
        started_at="2026-11-01T00:00:00+00:00",
        wall_seconds=1.0,
        status="completed",
        report="old",
        sources=(),
        usage={},
        cost_usd=None,
        meta={},
    )
    save_run(results, record, overwrite=False, log=log)


def _output(capsys: pytest.CaptureFixture[str]) -> list[str]:
    """The command's own lines, without the structured log lines."""
    lines = capsys.readouterr().out.splitlines()
    return [line for line in lines if line.startswith(("ok", "FAIL", "q1", "q2"))]


def test_runs_every_question_and_prints_one_line_each(
    tmp_path: Path, log: Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    _run(_args(runs=1), log, _service())

    assert _output(capsys) == [
        "q1-kev run 1: completed in 0 s, 1 sources",
        "q2-msft run 1: completed in 0 s, 1 sources",
    ]
    assert len(load_runs(tmp_path, log=log)) == 2


def test_resumes_at_next_free_run_number(
    tmp_path: Path, log: Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    _existing(tmp_path, "q1-kev", 1, log)
    _existing(tmp_path, "q1-kev", 3, log)

    _run(_args("q1-kev", 2), log, _service())

    lines = _output(capsys)
    assert [line.split(":")[0] for line in lines] == ["q1-kev run 2", "q1-kev run 4"]
    assert run_path(tmp_path, "ldr", "q1-kev", 4).exists()


def test_overwrite_restarts_at_one(tmp_path: Path, log: Logger) -> None:
    _existing(tmp_path, "q1-kev", 1, log)

    _run(_args("q1-kev", 1, overwrite=True), log, _service())

    (record,) = load_runs(tmp_path, log=log)
    assert record.report == "body"


def test_failed_research_is_saved_and_next_run_continues(
    tmp_path: Path, log: Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    _run(_args("q1-kev", 2), log, _service("failed"))

    records = load_runs(tmp_path, log=log)
    assert [(r.run, r.status, r.report) for r in records] == [
        (1, "failed", ""),
        (2, "failed", ""),
    ]
    assert "q1-kev run 2: failed" in capsys.readouterr().out


def test_missing_password_is_config_error(
    monkeypatch: pytest.MonkeyPatch, log: Logger
) -> None:
    monkeypatch.delenv("LDR_LAB_PASSWORD")

    with pytest.raises(ConfigError):
        _run(_args(), log, _service())


def test_bad_price_env_is_config_error(
    monkeypatch: pytest.MonkeyPatch, log: Logger
) -> None:
    monkeypatch.setenv("INSTANCE_PRICE_USD_PER_HOUR", "cheap")

    with pytest.raises(ConfigError, match="INSTANCE_PRICE_USD_PER_HOUR"):
        _run(_args(), log, _service())
