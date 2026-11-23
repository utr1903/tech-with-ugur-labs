"""Thin, logged wrapper around the kubectl binary."""

from __future__ import annotations

import os
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from app.errors import KubeError
from app.logging_setup import Logger

DEFAULT_CONTEXT = "kind-tetragon-bench"
TIMEOUT_S = 180


@dataclass(frozen=True)
class CompletedRun:
    """The captured result of one kubectl invocation."""

    stdout: str
    stderr: str
    returncode: int


def context_args() -> list[str]:
    """The `--context` flags pinning every call to the lab cluster."""
    return ["--context", os.environ.get("KUBE_CONTEXT", DEFAULT_CONTEXT)]


def _check(args: Sequence[str], result: CompletedRun, *, check: bool) -> None:
    if check and result.returncode != 0:
        raise KubeError(
            f"kubectl {' '.join(args)} exited {result.returncode}: "
            f"{result.stderr.strip()}"
        )


def kubectl(
    args: Sequence[str],
    *,
    stdin: str | None = None,
    log: Logger,
    check: bool = True,
) -> CompletedRun:
    """Runs kubectl against the lab context; raises KubeError on failure."""
    command = ["kubectl", *context_args(), *args]
    try:
        log.debug("Running kubectl...", args=list(args), check=check)
        proc = subprocess.run(
            command,
            input=stdin,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_S,
            check=False,
        )
        result = CompletedRun(proc.stdout, proc.stderr, proc.returncode)
        _check(args, result, check=check)
    except (OSError, subprocess.TimeoutExpired) as err:
        log.exception("Running kubectl failed.", args=list(args))
        raise KubeError(f"kubectl {' '.join(args)} could not run: {err}") from err
    except KubeError:
        log.exception("Running kubectl failed.", args=list(args))
        raise
    else:
        log.debug("Running kubectl succeeded.", returncode=result.returncode)
        return result


def exec_script(namespace: str, pod: str, script: Path, *, log: Logger) -> CompletedRun:
    """Pipes a local shell script into `sh -s` inside a pod; never raises on rc."""
    try:
        log.info(
            "Executing script...", namespace=namespace, pod=pod, script=str(script)
        )
        result = kubectl(
            ["exec", "-i", "-n", namespace, pod, "--", "sh", "-s"],
            stdin=script.read_text(),
            log=log,
            check=False,
        )
    except Exception:
        log.exception("Executing script failed.", pod=pod, script=str(script))
        raise
    else:
        log.info("Executing script succeeded.", pod=pod, returncode=result.returncode)
        return result
