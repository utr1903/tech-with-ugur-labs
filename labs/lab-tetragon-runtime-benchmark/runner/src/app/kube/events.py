"""Live Tetragon event stream: `kubectl logs -f` parsed in a thread."""

from __future__ import annotations

import subprocess
import threading
import time
from collections.abc import Sequence
from types import TracebackType

from app.errors import KubeError
from app.events.model import Event
from app.events.parse import parse_event
from app.kube.kubectl import context_args
from app.logging_setup import Logger

ATTACH_WAIT_S = 2.0


class EventStream:
    """Collects exec and kprobe events while the context is open."""

    def __init__(
        self,
        *,
        log: Logger,
        command: Sequence[str] | None = None,
        attach_wait_s: float = ATTACH_WAIT_S,
    ) -> None:
        self._log = log
        self._attach_wait_s = attach_wait_s
        self._command = command
        self._events: list[Event] = []
        self._lock = threading.Lock()
        self._proc: subprocess.Popen[str] | None = None
        self._thread: threading.Thread | None = None

    @staticmethod
    def _default_command() -> list[str]:
        return [
            "kubectl",
            *context_args(),
            "logs",
            "-f",
            "-n",
            "kube-system",
            "ds/tetragon",
            "-c",
            "export-stdout",
            "--since=1s",
        ]

    def __enter__(self) -> EventStream:
        command = self._command or self._default_command()
        self._log.info("Opening event stream...")
        self._proc = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            errors="replace",
        )
        try:
            self._thread = threading.Thread(target=self._read, daemon=True)
            self._thread.start()
            time.sleep(self._attach_wait_s)
        except BaseException:
            self._stop()
            raise
        self._log.info("Opening event stream succeeded.")
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self._stop()
        self._log.info("Event stream closed.", events=len(self._events))

    def _stop(self) -> None:
        proc = self._proc
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _read(self) -> None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        for line in proc.stdout:
            event = parse_event(line)
            if event is not None:
                with self._lock:
                    self._events.append(event)

    def snapshot(self) -> tuple[Event, ...]:
        """Every event received so far; raises if the stream has died."""
        proc, thread = self._proc, self._thread
        if proc is None or thread is None:
            raise KubeError("event stream is not open")
        if proc.poll() is not None or not thread.is_alive():
            raise KubeError(
                f"event stream died (exit code {proc.poll()}); "
                "results would be false negatives"
            )
        with self._lock:
            return tuple(self._events)
