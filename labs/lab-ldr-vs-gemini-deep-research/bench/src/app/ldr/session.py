"""An authenticated HTTP session against the Local Deep Research web app.

The service has no API keys: a browser-style login sets a session cookie
and a CSRF token must accompany every state-changing request.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

import httpx

from app.errors import ConfigError, LdrError
from app.logging_setup import Logger

_INPUT_TAG = re.compile(r'<input\b[^>]*name="csrf_token"[^>]*>')
_VALUE_ATTR = re.compile(r'value="([^"]+)"')
_LOGIN_OK = (302, 303)


@dataclass(frozen=True)
class LdrSettings:
    """Where the LDR service lives and how this lab logs in to it."""

    base_url: str
    username: str
    password: str
    model: str
    poll_seconds: float
    timeout_seconds: float


def ldr_settings_from_env(env: Mapping[str, str]) -> LdrSettings:
    """Reads the LDR settings; only the password has no default."""
    password = env.get("LDR_LAB_PASSWORD", "")
    if not password:
        raise ConfigError("LDR_LAB_PASSWORD is not set")
    return LdrSettings(
        base_url=env.get("LDR_URL", "http://ldr:5000").rstrip("/"),
        username=env.get("LDR_LAB_USERNAME", "lab"),
        password=password,
        model=env.get("LDR_MODEL", "qwen3.6-27b"),
        poll_seconds=_number(env, "LDR_POLL_SECONDS", 10.0),
        timeout_seconds=_number(env, "LDR_TIMEOUT_MINUTES", 60.0) * 60,
    )


def _number(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError as err:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from err


class LdrSession:
    """A cookie-holding client plus the CSRF token for API calls."""

    def __init__(self, client: httpx.Client, settings: LdrSettings) -> None:
        self.client = client
        self.settings = settings
        self.csrf_token = ""

    def login(self, *, log: Logger) -> None:
        """Logs in, registering the lab user first if it does not exist yet.

        A successful login answers with a redirect; a failed one re-renders
        the form with status 401. Logging in only once per command keeps
        clear of the service's login rate limit.
        """
        try:
            log.info("Logging in to LDR...", base_url=self.settings.base_url)
            self._authenticate(log)
            self.csrf_token = str(self.get_json("/auth/csrf-token")["csrf_token"])
        except (LdrError, KeyError):
            log.exception("Logging in to LDR failed.", base_url=self.settings.base_url)
            raise
        else:
            log.info("Logging in to LDR succeeded.")

    def _authenticate(self, log: Logger) -> None:
        if self._try_login():
            return
        log.info("Login refused, registering the lab user...")
        self._register()
        if not self._try_login():
            raise LdrError("login failed again after registering the user")

    def get_json(self, path: str) -> dict[str, object]:
        """GETs a JSON object from the service."""
        return self._send("GET", path)

    def post_json(self, path: str, payload: Mapping[str, object]) -> dict[str, object]:
        """POSTs a JSON body with the CSRF header and returns the JSON reply."""
        return self._send("POST", path, payload)

    def _send(
        self, method: str, path: str, payload: Mapping[str, object] | None = None
    ) -> dict[str, object]:
        headers = {"X-CSRFToken": self.csrf_token} if method == "POST" else None
        response = self._request(method, path, headers=headers, json=payload)
        if not response.is_success:
            raise LdrError(f"{method} {path} returned {response.status_code}")
        try:
            data = response.json()
        except ValueError as err:
            raise LdrError(f"{method} {path} did not return JSON") from err
        if not isinstance(data, dict):
            raise LdrError(f"{method} {path} did not return a JSON object")
        return {str(k): v for k, v in data.items()}

    def _try_login(self) -> bool:
        form = {"username": self.settings.username, "password": self.settings.password}
        response = self._post_form("/auth/login", form)
        if response.status_code in _LOGIN_OK:
            return True
        if response.status_code in (200, 400, 401):
            return False
        raise LdrError(f"POST /auth/login returned {response.status_code}")

    def _register(self) -> None:
        form = {
            "username": self.settings.username,
            "password": self.settings.password,
            "confirm_password": self.settings.password,
            "acknowledge": "true",
        }
        response = self._post_form("/auth/register", form)
        if response.status_code not in _LOGIN_OK:
            raise LdrError(f"POST /auth/register returned {response.status_code}")

    def _post_form(self, path: str, form: Mapping[str, str]) -> httpx.Response:
        page = self._request("GET", path)
        if page.status_code != 200:
            raise LdrError(f"GET {path} returned {page.status_code}")
        token = _scrape_csrf(page.text, path)
        return self._request("POST", path, data={**form, "csrf_token": token})

    def _request(
        self,
        method: str,
        path: str,
        *,
        headers: Mapping[str, str] | None = None,
        data: Mapping[str, str] | None = None,
        json: Mapping[str, object] | None = None,
    ) -> httpx.Response:
        try:
            return self.client.request(
                method,
                f"{self.settings.base_url}{path}",
                headers=headers,
                data=data,
                json=json,
            )
        except httpx.HTTPError as err:
            raise LdrError(f"{method} {path} failed: {err}") from err


def _scrape_csrf(html: str, path: str) -> str:
    tag = _INPUT_TAG.search(html)
    value = _VALUE_ATTR.search(tag.group(0)) if tag else None
    if value is None:
        raise LdrError(f"no csrf_token input found on {path}")
    return value.group(1)
