from __future__ import annotations

import copy

from app.policies.profile import (
    LAB_LABEL_KEY,
    LAB_LABEL_VALUE,
    downgrade_overrides,
    ensure_lab_label,
    render_policy,
)


def _doc() -> dict[str, object]:
    return {
        "apiVersion": "cilium.io/v1alpha1",
        "kind": "TracingPolicy",
        "metadata": {"name": "p"},
        "spec": {
            "kprobes": [
                {
                    "call": "security_file_open",
                    "selectors": [
                        {"matchActions": [{"action": "Override", "argError": -1}]},
                        {"matchActions": [{"action": "Post"}]},
                    ],
                },
                {
                    "call": "sys_unlinkat",
                    "selectors": [
                        {"matchActions": [{"action": "Override", "argError": -1}]}
                    ],
                },
            ]
        },
    }


def _options(doc: dict[str, object]) -> list[object]:
    spec = doc["spec"]
    assert isinstance(spec, dict)
    options = spec["options"]
    assert isinstance(options, list)
    return options


def test_render_sets_monitor_mode() -> None:
    rendered = render_policy(_doc(), mode="monitor")
    assert _options(rendered) == [{"name": "policy-mode", "value": "monitor"}]


def test_render_replaces_existing_mode() -> None:
    doc = _doc()
    spec = doc["spec"]
    assert isinstance(spec, dict)
    spec["options"] = [
        {"name": "other", "value": "x"},
        {"name": "policy-mode", "value": "monitor"},
    ]
    rendered = render_policy(doc, mode="enforce")
    assert _options(rendered) == [
        {"name": "other", "value": "x"},
        {"name": "policy-mode", "value": "enforce"},
    ]


def test_render_does_not_mutate_input() -> None:
    doc = _doc()
    before = copy.deepcopy(doc)
    render_policy(doc, mode="monitor")
    downgrade_overrides(doc)
    ensure_lab_label(doc)
    assert doc == before


def test_downgrade_replaces_override_with_sigkill_everywhere() -> None:
    rendered = downgrade_overrides(_doc())
    spec = rendered["spec"]
    assert isinstance(spec, dict)
    actions = [
        action["action"]
        for kprobe in spec["kprobes"]
        for selector in kprobe["selectors"]
        for action in selector["matchActions"]
    ]
    assert actions == ["Sigkill", "Post", "Sigkill"]
    assert "argError" not in str(rendered)


def test_ensure_lab_label_adds_label() -> None:
    labelled = ensure_lab_label(_doc())
    metadata = labelled["metadata"]
    assert isinstance(metadata, dict)
    assert metadata["labels"] == {LAB_LABEL_KEY: LAB_LABEL_VALUE}
