"""Reading tool usage out of a session's stored messages."""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Iterable, Iterator, Mapping

TRACKED_TOOLS = (
    "delegate_task",
    "execute_code",
    "skill_view",
    "skill_manage",
    "skills_list",
    "memory",
    "terminal",
    "read_file",
    "search_files",
)
_SKILL_TOOLS = ("skill_manage", "skill_view")


def count_tools(messages: Iterable[Mapping[str, object]]) -> Counter[str]:
    """Counts assistant tool calls by tool name."""
    return Counter(name for name, _ in _calls(messages))


def skill_actions(messages: Iterable[Mapping[str, object]]) -> list[tuple[str, str]]:
    """Returns (tool, skill name) for each skill_manage / skill_view call."""
    found: list[tuple[str, str]] = []
    for name, arguments in _calls(messages):
        if name in _SKILL_TOOLS:
            skill = _arguments(arguments).get("name")
            if isinstance(skill, str):
                found.append((name, skill))
    return found


def skill_calls(
    messages: Iterable[Mapping[str, object]],
) -> list[tuple[str, str, str]]:
    """Returns (tool, skill name, action) for each skill tool call.

    `action` is the skill_manage action ("create", "patch", ...), or "" when
    the call has none (skill_view).
    """
    found: list[tuple[str, str, str]] = []
    for name, arguments in _calls(messages):
        if name in _SKILL_TOOLS:
            args = _arguments(arguments)
            skill, action = args.get("name"), args.get("action")
            if isinstance(skill, str):
                found.append((name, skill, action if isinstance(action, str) else ""))
    return found


def _calls(messages: Iterable[Mapping[str, object]]) -> Iterator[tuple[str, object]]:
    for message in messages:
        if message.get("role") != "assistant":
            continue
        calls = message.get("tool_calls")
        for call in calls if isinstance(calls, list) else []:
            function = call.get("function") if isinstance(call, dict) else None
            if isinstance(function, dict) and isinstance(function.get("name"), str):
                yield function["name"], function.get("arguments")


def _arguments(raw: object) -> dict[str, object]:
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
