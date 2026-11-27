"""Finds the structured answer block at the end of a research report."""

from __future__ import annotations

import json
import re

_JSON_BLOCK = re.compile(r"```[ \t]*json[ \t]*\r?\n(.*?)```", re.IGNORECASE | re.DOTALL)


def extract_last_json_block(report: str) -> object | None:
    """Returns the last fenced json block that parses, or None."""
    for match in reversed(_JSON_BLOCK.findall(report)):
        try:
            parsed: object = json.loads(match)
        except json.JSONDecodeError:
            continue
        return parsed
    return None
