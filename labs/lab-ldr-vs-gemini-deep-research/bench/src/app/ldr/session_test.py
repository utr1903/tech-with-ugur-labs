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


class FakeLdr:
    """Emulates the service's cookie behaviour: once logged in, GET /auth/login
    redirects home instead of showing the form."""

    def __init__(
        self, *, user_exists: bool = False, registrations: bool = True
    ) -> None:
        self.logged_in = False
        self.user_exists = user_exists
        self.registrations = registrations
        self.calls: list[tuple[str, str]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append((request.method, path))
        if path == "/auth/csrf-token":
            return httpx.Response(200, json={"csrf_token": "api-tok"})
        if request.method == "GET":
            if path == "/auth/login" and self.logged_in:
                return httpx.Response(302, headers={"location": "/"})
            return httpx.Response(200, text=_FORM.format(n=path))
        if path == "/auth/login":
            self.logged_in = self.user_exists
            return self._redirect("/") if self.user_exists else httpx.Response(401)
        if not self.registrations:
            return self._redirect("/auth/login")
        if self.user_exists:
            return httpx.Response(400, text="exists")
        self.logged_in = True
        return self._redirect("/")

    @staticmethod
    def _redirect(location: str) -> httpx.Response:
        return httpx.Response(302, headers={"location": location})


def test_first_run_registers_and_skips_second_login(log: Logger) -> None:
    service = FakeLdr()
    session = _session(httpx.MockTransport(service))

    session.login(log=log)

    assert session.csrf_token == "api-tok"
    assert service.calls.count(("POST", "/auth/login")) == 1
    assert ("GET", "/auth/login") in service.calls


def test_already_logged_in_login_page_redirect_counts_as_success(
    log: Logger,
) -> None:
    service = FakeLdr(user_exists=True)
    service.logged_in = True
    session = _session(httpx.MockTransport(service))

    session.login(log=log)

    assert session.csrf_token == "api-tok"
    assert ("POST", "/auth/login") not in service.calls


def test_registrations_disabled_is_not_success(log: Logger) -> None:
    session = _session(httpx.MockTransport(FakeLdr(registrations=False)))

    with pytest.raises(LdrError, match="disabled"):
        session.login(log=log)


def test_wrong_password_for_existing_user_is_explained(log: Logger) -> None:
    service = FakeLdr(user_exists=True)
    service.user_exists = True

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/auth/login":
            return httpx.Response(401)
        return service(request)

    with pytest.raises(LdrError, match=r"wrong LDR_LAB_PASSWORD\?"):
        _session(httpx.MockTransport(handler)).login(log=log)


def test_missing_csrf_token_in_reply_is_ldr_error(log: Logger) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/csrf-token":
            return httpx.Response(200, json={})
        return FakeLdr()(request)

    with pytest.raises(LdrError, match="no csrf_token in /auth/csrf-token reply"):
        _session(httpx.MockTransport(handler)).login(log=log)


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


class ExpiringLdr(FakeLdr):
    """A logged-in service whose session lapses; API calls then need a re-login."""

    def __init__(self, *, expiry_status: int) -> None:
        super().__init__(user_exists=True)
        self.expiry_status = expiry_status

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/x" and not self.logged_in:
            self.calls.append((request.method, request.url.path))
            if self.expiry_status == 302:
                return self._redirect("/auth/login?next=/api/x")
            return httpx.Response(self.expiry_status)
        if request.url.path == "/api/x":
            self.calls.append((request.method, request.url.path))
            return httpx.Response(200, json={"ok": 1})
        return super().__call__(request)


@pytest.mark.parametrize("status", [401, 302])
def test_expired_session_logs_in_again_and_retries_once(
    log: Logger, status: int
) -> None:
    service = ExpiringLdr(expiry_status=status)
    session = _session(httpx.MockTransport(service))
    session.login(log=log)
    service.logged_in = False

    assert session.get_json("/api/x") == {"ok": 1}

    assert service.calls.count(("POST", "/auth/login")) == 2
    assert service.calls.count(("GET", "/api/x")) == 2


def test_session_that_stays_expired_fails_after_one_retry(log: Logger) -> None:
    service = FakeLdr(user_exists=True)
    api_calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/x":
            api_calls.append(request.url.path)
            return httpx.Response(401)
        return service(request)

    session = _session(httpx.MockTransport(handler))
    session.login(log=log)

    with pytest.raises(LdrError, match="401"):
        session.get_json("/api/x")

    assert len(api_calls) == 2
