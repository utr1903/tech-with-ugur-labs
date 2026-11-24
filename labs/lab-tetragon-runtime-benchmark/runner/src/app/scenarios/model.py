"""Scenario definitions and the signals that count as detection."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

# Ports of the attacker pod's sinks and the name each one logs under
# (images/attacker/sinks.py).
ATTACKER_SINKS: dict[int, str] = {8080: "http", 4444: "revshell", 3333: "stratum"}


@dataclass(frozen=True)
class Matcher:
    """One event pattern; every set field must match for it to fire."""

    kind: Literal["exec", "kprobe"]
    policy: str | None
    binary_prefix: str | None
    binary_regex: str | None
    args_regex: str | None


@dataclass(frozen=True)
class Scenario:
    """One attack (or benign) scenario loaded from its scenario.yaml."""

    id: str
    technique: str
    name: str
    tactic: str
    pod: str
    namespace: str
    benign: bool
    expected_tuned: Literal["detect", "miss"]
    expected_enforce: Literal["block", "detect", "none"]
    requires: tuple[str, ...]
    signals: tuple[Matcher, ...]
    directory: Path
    # When set, the side effect is "the attacker sink on this port saw a
    # connection from the scenario pod", read from the attacker log instead
    # of check.sh.
    attacker_sink: int | None = None
