"""The `check` command: is the stack up and able to run a research?"""

from __future__ import annotations

import argparse
import os
from collections.abc import Callable

import httpx

from app.errors import ConfigError, LabError, LdrError
from app.ldr.session import LdrSession, LdrSettings, ldr_settings_from_env
from app.logging_setup import Logger
from app.output import write_line

_DEFAULT_MODEL_URL = "http://host.docker.internal:8000/v1/models"
_REQUEST_TIMEOUT_SECONDS = 60


def run(
    args: argparse.Namespace,
    *,
    log: Logger,
    transport: httpx.BaseTransport | None = None,
) -> None:
    """Prints ok/FAIL for each check and raises if any failed."""
    settings = ldr_settings_from_env(os.environ)
    model_url = os.environ.get("MODEL_URL", _DEFAULT_MODEL_URL)
    log.info("Checking the stack...", command=args.command)

    with httpx.Client(timeout=_REQUEST_TIMEOUT_SECONDS, transport=transport) as client:
        checks: tuple[tuple[str, Callable[[], None]], ...] = (
            ("ldr reachable", lambda: _reachable(client, settings)),
            ("model listed", lambda: _model_listed(client, model_url, settings)),
            ("ldr login", lambda: LdrSession(client, settings).login(log=log)),
        )
        failed = [name for name, check in checks if not _report(name, check, log)]
    if failed:
        raise ConfigError(f"checks failed: {', '.join(failed)}")


def _report(name: str, check: Callable[[], None], log: Logger) -> bool:
    try:
        check()
    except (LabError, httpx.HTTPError) as err:
        log.warning("Check failed.", check=name, error=str(err))
        write_line(f"FAIL  {name}: {err}")
        return False
    write_line(f"ok    {name}")
    return True


def _reachable(client: httpx.Client, settings: LdrSettings) -> None:
    """The home page redirects to the login form, so any non-error status is up."""
    response = client.get(f"{settings.base_url}/")
    if response.status_code >= 400:
        raise LdrError(f"GET / returned {response.status_code}")


def _model_listed(client: httpx.Client, url: str, settings: LdrSettings) -> None:
    response = client.get(url).raise_for_status()
    try:
        body = response.json()
    except ValueError as err:
        raise ConfigError(f"{url} did not return JSON") from err
    models = body.get("data") if isinstance(body, dict) else None
    if not isinstance(models, list):
        raise ConfigError(f"{url} did not return a model list")
    served = [str(m.get("id")) for m in models if isinstance(m, dict)]
    if settings.model not in served:
        raise ConfigError(f"{settings.model} is not served; found {served}")
