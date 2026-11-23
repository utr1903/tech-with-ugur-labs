"""Applies and removes lab TracingPolicies on the live cluster."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Literal

import yaml

from app.bench.model import Profile
from app.errors import PolicyError
from app.kube.kubectl import kubectl
from app.kube.tetra import parse_policy_list, tetra
from app.logging_setup import Logger
from app.policies.profile import (
    LAB_LABEL_KEY,
    LAB_LABEL_VALUE,
    downgrade_overrides,
    ensure_lab_label,
    render_policy,
)

READY_TIMEOUT_S = 60.0
POLL_S = 1.0
SETTLE_S = 3.0
_SELECTOR = f"{LAB_LABEL_KEY}={LAB_LABEL_VALUE}"


def delete_lab_policies(*, log: Logger) -> None:
    """Deletes every policy labelled as a lab policy."""
    try:
        log.info("Deleting lab policies...")
        kubectl(
            ["delete", "tracingpolicy", "-l", _SELECTOR, "--ignore-not-found"], log=log
        )
    except Exception:
        log.exception("Deleting lab policies failed.")
        raise
    else:
        log.info("Deleting lab policies succeeded.")


def delete_policy(name: str, *, log: Logger) -> None:
    """Deletes one policy by name; absent is fine."""
    try:
        log.info("Deleting policy...", policy=name)
        kubectl(["delete", "tracingpolicy", name, "--ignore-not-found"], log=log)
    except Exception:
        log.exception("Deleting policy failed.", policy=name)
        raise
    else:
        log.info("Deleting policy succeeded.", policy=name)


def _load_doc(path: Path) -> dict[str, object]:
    try:
        raw = yaml.safe_load(path.read_text())
    except (yaml.YAMLError, OSError) as err:
        raise PolicyError(f"{path}: cannot read policy: {err}") from err
    if not isinstance(raw, dict):
        raise PolicyError(f"{path}: policy must be a mapping")
    return {str(k): v for k, v in raw.items()}


def _policy_name(doc: dict[str, object], path: Path) -> str:
    metadata = doc.get("metadata")
    name = metadata.get("name") if isinstance(metadata, dict) else None
    if not isinstance(name, str) or not name:
        raise PolicyError(f"{path}: metadata.name is missing")
    return name


def apply_policy_file(
    path: Path,
    *,
    mode: Literal["monitor", "enforce"],
    override: bool,
    log: Logger,
) -> str:
    """Renders one policy file for `mode`, applies it, returns its name."""
    try:
        log.info("Applying policy...", path=str(path), mode=mode, override=override)
        doc = ensure_lab_label(_load_doc(path))
        if not override:
            doc = downgrade_overrides(doc)
        name = _policy_name(doc, path)
        rendered = render_policy(doc, mode=mode)
        kubectl(["apply", "-f", "-"], stdin=yaml.safe_dump(rendered), log=log)
    except Exception:
        log.exception("Applying policy failed.", path=str(path), mode=mode)
        raise
    else:
        log.info("Applying policy succeeded.", policy=name, mode=mode)
        return name


def _wait_ready(names: dict[str, str], *, log: Logger) -> None:
    deadline = time.monotonic() + READY_TIMEOUT_S
    pending = dict(names)
    while time.monotonic() < deadline:
        listed = parse_policy_list(tetra(["tracingpolicy", "list"], log=log))
        pending = {
            name: mode
            for name, mode in names.items()
            if listed.get(name) != ("enabled", mode)
        }
        if not pending:
            return
        time.sleep(POLL_S)
    raise PolicyError(f"policies not enabled in time: {pending}")


def apply_profile(
    profile: Profile, policy_dir: Path, *, override: bool, log: Logger
) -> None:
    """Puts the cluster into `profile`: no policies, monitor or enforce."""
    try:
        log.info("Applying profile...", profile=profile, policy_dir=str(policy_dir))
        delete_lab_policies(log=log)
        applied: dict[str, str] = {}
        if profile != "default":
            mode: Literal["monitor", "enforce"] = (
                "enforce" if profile == "enforce" else "monitor"
            )
            for path in sorted(policy_dir.glob("*.yaml")):
                name = apply_policy_file(path, mode=mode, override=override, log=log)
                applied[name] = mode
            if applied:
                _wait_ready(applied, log=log)
                time.sleep(SETTLE_S)
    except Exception:
        log.exception("Applying profile failed.", profile=profile)
        raise
    else:
        log.info("Applying profile succeeded.", profile=profile, policies=len(applied))
