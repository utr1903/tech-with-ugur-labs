from __future__ import annotations

import argparse
from collections.abc import Callable

import httpx
import pytest

from app.commands import check
from app.errors import ConfigError
from app.logging_setup import Logger, get_logger

type Handler = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def log() -> Logger:
    return get_logger()


@pytest.fixture(autouse=True)
def env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LDR_LAB_PASSWORD", "pw")
    monkeypatch.delenv("MODEL_URL", raising=False)


def _handler(*, model: str = "qwen3.6-27b", login_status: int = 302) -> Handler:
    def handler(request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        if host == "host.docker.internal":
            return httpx.Response(200, json={"data": [{"id": model}]})
        if path == "/" and request.method == "GET":
            return httpx.Response(200, text="home")
        if path.startswith("/auth/") and request.method == "GET":
            if path == "/auth/csrf-token":
                return httpx.Response(200, json={"csrf_token": "t"})
            return httpx.Response(200, text='<input name="csrf_token" value="t">')
        return httpx.Response(login_status, headers={"location": "/"})

    return handler


def _check(log: Logger, handler: Handler) -> None:
    check.run(
        argparse.Namespace(command="check"),
        log=log,
        transport=httpx.MockTransport(handler),
    )


def _output(capsys: pytest.CaptureFixture[str]) -> list[str]:
    """The command's own lines, without the structured log lines."""
    lines = capsys.readouterr().out.splitlines()
    return [line for line in lines if line.startswith(("ok", "FAIL", "q1", "q2"))]


def test_all_checks_pass(log: Logger, capsys: pytest.CaptureFixture[str]) -> None:
    _check(log, _handler())

    out = _output(capsys)
    assert len(out) == 3
    assert all(line.startswith("ok") for line in out)


def test_missing_model_fails_but_runs_every_check(
    log: Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(ConfigError, match="model"):
        _check(log, _handler(model="other"))

    out = _output(capsys)
    assert [line.split()[0] for line in out] == ["ok", "FAIL", "ok"]


def test_unreachable_service_fails(
    log: Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(ConfigError):
        _check(log, down)

    assert "\n".join(_output(capsys)).count("FAIL") == 3


def test_login_failure_is_reported(
    log: Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(ConfigError, match="login"):
        _check(log, _handler(login_status=500))

    assert "FAIL" in _output(capsys)[2]
