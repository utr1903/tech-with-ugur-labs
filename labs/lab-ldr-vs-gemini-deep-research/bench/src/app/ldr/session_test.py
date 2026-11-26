from __future__ import annotations

import json

import httpx
import pytest

from app.errors import ConfigError, LdrError
from app.ldr.session import LdrSession, LdrSettings, ldr_settings_from_env
from app.logging_setup import Logger, get_logger

_FORM = 'x <input type="hidden" name="csrf_token" value="tok-{n}"/> y'


@pytest.fixture
def log() -> Logger:
    return get_logger()


def _settings() -> LdrSettings:
    return LdrSettings(
        base_url="http://ldr:5000",
        username="lab",
        password="secret-pw",
        model="qwen3.6-27b",
        poll_seconds=0.0,
        timeout_seconds=60.0,
    )


def _session(handler: httpx.MockTransport) -> LdrSession:
    return LdrSession(httpx.Client(transport=handler), _settings())


def test_settings_defaults_and_required_password() -> None:
    settings = ldr_settings_from_env({"LDR_LAB_PASSWORD": "pw"})

    assert settings == LdrSettings(
        base_url="http://ldr:5000",
        username="lab",
        password="pw",
        model="qwen3.6-27b",
        poll_seconds=10.0,
        timeout_seconds=3600.0,
    )
    with pytest.raises(ConfigError, match="LDR_LAB_PASSWORD"):
        ldr_settings_from_env({})


def test_settings_overrides() -> None:
    settings = ldr_settings_from_env(
        {
            "LDR_LAB_PASSWORD": "pw",
            "LDR_URL": "http://x:1",
            "LDR_TIMEOUT_MINUTES": "2",
            "LDR_POLL_SECONDS": "0.5",
        }
    )

    assert (settings.base_url, settings.timeout_seconds, settings.poll_seconds) == (
        "http://x:1",
        120.0,
        0.5,
    )


def test_settings_reject_non_numeric() -> None:
    with pytest.raises(ConfigError, match="LDR_POLL_SECONDS"):
        ldr_settings_from_env({"LDR_LAB_PASSWORD": "pw", "LDR_POLL_SECONDS": "x"})


def test_login_success_stores_csrf_token(log: Logger) -> None:
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        if request.url.path == "/auth/login" and request.method == "GET":
            return httpx.Response(200, text=_FORM.format(n=1))
        if request.url.path == "/auth/login":
            body = request.content.decode()
            assert "csrf_token=tok-1" in body
            assert "username=lab" in body
            return httpx.Response(302, headers={"location": "/"})
        return httpx.Response(200, json={"csrf_token": "api-tok"})

    session = _session(httpx.MockTransport(handler))

    session.login(log=log)

    assert session.csrf_token == "api-tok"
    assert ("GET", "/auth/register") not in seen


def test_login_failure_registers_then_logs_in(log: Logger) -> None:
    logins = 0
    forms: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal logins
        path = request.url.path
        if request.method == "GET" and path in ("/auth/login", "/auth/register"):
            return httpx.Response(200, text=_FORM.format(n=path))
        if path == "/auth/login":
            logins += 1
            if logins == 1:
                return httpx.Response(401, text="bad credentials")
            return httpx.Response(302, headers={"location": "/"})
        if path == "/auth/register":
            forms.append(request.content.decode())
            return httpx.Response(302, headers={"location": "/"})
        return httpx.Response(200, json={"csrf_token": "api-tok"})

    session = _session(httpx.MockTransport(handler))

    session.login(log=log)

    assert logins == 2
    assert "confirm_password=secret-pw" in forms[0]
    assert "acknowledge=true" in forms[0]
    assert session.csrf_token == "api-tok"


def test_login_that_keeps_failing_raises_with_status(log: Logger) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, text=_FORM.format(n=1))
        return httpx.Response(401, text="no")

    with pytest.raises(LdrError, match="401"):
        _session(httpx.MockTransport(handler)).login(log=log)


def test_login_rate_limit_raises_without_registering(log: Logger) -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.method == "GET":
            return httpx.Response(200, text=_FORM.format(n=1))
        return httpx.Response(429, text="slow down")

    with pytest.raises(LdrError, match="429"):
        _session(httpx.MockTransport(handler)).login(log=log)

    assert "/auth/register" not in paths


def test_missing_csrf_input_raises(log: Logger) -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(200, text="<html/>"))

    with pytest.raises(LdrError, match="csrf"):
        _session(transport).login(log=log)


def test_post_json_sends_csrf_header_and_body() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"ok": 1})

    session = _session(httpx.MockTransport(handler))
    session.csrf_token = "api-tok"

    assert session.post_json("/api/x", {"a": 1}) == {"ok": 1}
    assert captured[0].headers["X-CSRFToken"] == "api-tok"
    assert json.loads(captured[0].content) == {"a": 1}


def test_get_json_non_2xx_raises_with_status() -> None:
    session = _session(httpx.MockTransport(lambda _: httpx.Response(500, text="x")))

    with pytest.raises(LdrError, match="500"):
        session.get_json("/api/x")


def test_transport_error_becomes_ldr_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(LdrError):
        _session(httpx.MockTransport(handler)).get_json("/api/x")
