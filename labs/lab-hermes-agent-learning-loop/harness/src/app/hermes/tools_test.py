from __future__ import annotations

import json

from app.hermes.tools import count_tools, skill_actions, skill_calls


def _call(name: str, arguments: object) -> dict[str, object]:
    return {
        "id": "c1",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }


MESSAGES: list[dict[str, object]] = [
    {"role": "user", "content": "go", "tool_calls": None},
    {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            _call("terminal", {"command": "ls"}),
            _call("skill_manage", {"action": "create", "name": "count-and-ips"}),
        ],
    },
    {"role": "tool", "content": "ok", "tool_name": "terminal", "tool_calls": None},
    {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            _call("terminal", {"command": "cat"}),
            _call("skill_view", {"name": "count-and-ips"}),
        ],
    },
]


def test_count_tools_from_messages() -> None:
    counts = count_tools(MESSAGES)
    assert counts["terminal"] == 2
    assert counts["skill_manage"] == 1
    assert counts["delegate_task"] == 0


def test_skill_actions_parsed() -> None:
    assert skill_actions(MESSAGES) == [
        ("skill_manage", "count-and-ips"),
        ("skill_view", "count-and-ips"),
    ]


def test_skill_actions_skips_bad_arguments() -> None:
    bad: list[dict[str, object]] = [
        {
            "role": "assistant",
            "tool_calls": [
                {"function": {"name": "skill_view", "arguments": "{not json"}}
            ],
        }
    ]
    assert skill_actions(bad) == []


def test_skill_calls_include_the_action() -> None:
    assert skill_calls(MESSAGES)[0] == ("skill_manage", "count-and-ips", "create")
    view = [
        {
            "role": "assistant",
            "tool_calls": [_call("skill_view", {"name": "count-and-ips"})],
        }
    ]
    assert skill_calls(view) == [("skill_view", "count-and-ips", "")]
