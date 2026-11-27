"""Collecting subagent sessions, tool counts and skill calls for a run."""

from __future__ import annotations

from collections import Counter

from app.hermes.client import HermesApi
from app.hermes.models import SessionRow
from app.hermes.tools import count_tools, skill_calls


def collect_children(
    client: HermesApi, session_id: str, *, known: frozenset[str] = frozenset()
) -> list[SessionRow]:
    """Subagent sessions of `session_id` whose ids are not in `known`."""
    return [
        row
        for row in client.sessions(include_children=True)
        if row.parent_session_id == session_id and row.id not in known
    ]


def collect_tools(client: HermesApi, children: list[SessionRow]) -> Counter[str]:
    """Tool call counts summed over the children's stored messages."""
    total: Counter[str] = Counter()
    for child in children:
        total.update(count_tools(client.messages(child.id)))
    return total


def collect_skill_calls(
    client: HermesApi, session_ids: list[str]
) -> list[tuple[str, str, str]]:
    """(tool, skill name, action) for every skill call in the sessions."""
    calls: list[tuple[str, str, str]] = []
    for session_id in session_ids:
        calls.extend(skill_calls(client.messages(session_id)))
    return calls


def model_of(client: HermesApi, session_id: str) -> str:
    """The model recorded on the session row, or an empty string."""
    for row in client.sessions(include_children=False):
        if row.id == session_id:
            return row.model
    return ""
