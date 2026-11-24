"""A Tetragon event reduced to the fields the bench scores."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal


@dataclass(frozen=True)
class Event:
    """One exec or kprobe event from the Tetragon export stream."""

    kind: Literal["exec", "kprobe"]
    time: datetime
    pod: str
    namespace: str
    binary: str
    arguments: str
    policy: str | None
    function: str | None
    action: str | None
