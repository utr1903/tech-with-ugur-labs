"""Decides whether an event satisfies a scenario signal."""

from __future__ import annotations

import re

from app.events.model import Event
from app.scenarios.model import Matcher


def matches(event: Event, matcher: Matcher) -> bool:
    """True when the kinds agree and every field the matcher sets matches.

    A kprobe matcher without a policy matches every lab policy's event, which is
    how benign scenarios catch any false positive.
    """
    if event.kind != matcher.kind:
        return False
    if (
        event.kind == "kprobe"
        and matcher.policy is not None
        and event.policy != matcher.policy
    ):
        return False
    if matcher.binary_prefix is not None and not event.binary.startswith(
        matcher.binary_prefix
    ):
        return False
    if matcher.binary_regex is not None and not re.search(
        matcher.binary_regex, event.binary
    ):
        return False
    return not (
        matcher.args_regex is not None
        and not re.search(matcher.args_regex, event.arguments)
    )
