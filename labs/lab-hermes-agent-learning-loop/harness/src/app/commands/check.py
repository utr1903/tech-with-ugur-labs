"""The `check` command: Hermes is healthy, pinned, and on the right model."""

from __future__ import annotations

import time
from collections.abc import Callable

from app.envvars import Settings
from app.errors import HermesError
from app.hermes.client import HermesApi
from app.hermes.home import save_baseline, snapshot_path
from app.hermes.models import TERMINAL_EVENTS
from app.logging_setup import Logger
from app.output import write_line

EXPECTED_VERSION = "0.23.4"
PROBE_PROMPT = "Reply with the single word ready."
PROBE_TIMEOUT_S = 120.0
READY_TIMEOUT_S = 60.0
READY_INTERVAL_S = 2.0
COMPLETED = "run.completed"


def _wait_healthy(
    client: HermesApi,
    *,
    sleep: Callable[[float], None],
    monotonic: Callable[[], float],
    log: Logger,
) -> dict[str, object]:
    """Polls /health until status is ok; compose may report up too early."""
    deadline = monotonic() + READY_TIMEOUT_S
    while True:
        try:
            doc = client.health()
        except HermesError:
            log.warning("Health request failed; retrying.")
            doc = {}
        if doc.get("status") == "ok":
            return doc
        if monotonic() >= deadline:
            raise HermesError(
                f"Hermes not ready after {READY_TIMEOUT_S:.0f}s: "
                f"status={doc.get('status')!r}"
            )
        sleep(READY_INTERVAL_S)


def _require_version(doc: dict[str, object]) -> None:
    if doc.get("version") != EXPECTED_VERSION:
        raise HermesError(
            f"Hermes version is {doc.get('version')!r}, expected {EXPECTED_VERSION!r}."
        )


def _probe(client: HermesApi, expected_model: str) -> None:
    run_id = client.start_run(PROBE_PROMPT)
    last = ""
    for event in client.stream_events(run_id, timeout_s=PROBE_TIMEOUT_S):
        if event.event in TERMINAL_EVENTS:
            last = event.event
            break
    if last != COMPLETED:
        raise HermesError(f"Probe run ended with {last or 'no terminal event'}.")
    row = next((r for r in client.sessions() if r.id == run_id), None)
    if row is None:
        raise HermesError(f"Probe session {run_id} not found.")
    if row.model != expected_model:
        raise HermesError(
            f"Hermes uses model {row.model!r}, expected {expected_model!r}."
        )


def run(
    settings: Settings,
    client: HermesApi,
    *,
    home_name: str,
    expected_model: str,
    log: Logger,
    sleep: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> None:
    """Verifies Hermes and records the home's skill baseline once."""
    try:
        log.info("Checking Hermes...", home=home_name, model=expected_model)
        doc = _wait_healthy(client, sleep=sleep, monotonic=monotonic, log=log)
        _require_version(doc)
        _probe(client, expected_model)
        dest = snapshot_path(settings.results_dir, home_name)
        created = not dest.exists()
        if created:
            save_baseline(settings.hermes_home, dest, log=log)
    except Exception:
        log.exception("Checking Hermes failed.", home=home_name)
        raise
    else:
        log.info("Checking Hermes succeeded.", baseline_created=created)
        write_line(
            f"Hermes {EXPECTED_VERSION} ready on {expected_model}; "
            f"baseline {'created' if created else 'kept'} for {home_name}"
        )
