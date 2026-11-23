"""Pure transformations of TracingPolicy documents; no cluster access."""

from __future__ import annotations

import copy
from typing import Literal

LAB_LABEL_KEY = "lab"
LAB_LABEL_VALUE = "tetragon-bench"
MODE_OPTION = "policy-mode"


def _section(doc: dict[str, object], key: str) -> dict[str, object]:
    section = doc.setdefault(key, {})
    if not isinstance(section, dict):
        raise TypeError(f"{key} must be a mapping")
    return section


def render_policy(
    doc: dict[str, object], *, mode: Literal["monitor", "enforce"]
) -> dict[str, object]:
    """Copy of `doc` whose spec.options carries exactly one policy-mode."""
    rendered = copy.deepcopy(doc)
    spec = _section(rendered, "spec")
    existing = spec.get("options", [])
    kept = [
        option
        for option in (existing if isinstance(existing, list) else [])
        if not (isinstance(option, dict) and option.get("name") == MODE_OPTION)
    ]
    spec["options"] = [*kept, {"name": MODE_OPTION, "value": mode}]
    return rendered


def _downgrade(node: object) -> object:
    if isinstance(node, dict):
        if node.get("action") == "Override":
            return {"action": "Sigkill"}
        return {key: _downgrade(value) for key, value in node.items()}
    if isinstance(node, list):
        return [_downgrade(item) for item in node]
    return node


def downgrade_overrides(doc: dict[str, object]) -> dict[str, object]:
    """Copy of `doc` with every Override action replaced by Sigkill."""
    downgraded = _downgrade(copy.deepcopy(doc))
    if not isinstance(downgraded, dict):
        raise TypeError("policy document must be a mapping")
    return {str(key): value for key, value in downgraded.items()}


def ensure_lab_label(doc: dict[str, object]) -> dict[str, object]:
    """Copy of `doc` labelled so the runner can find and delete it."""
    labelled = copy.deepcopy(doc)
    metadata = _section(labelled, "metadata")
    labels = metadata.setdefault("labels", {})
    if not isinstance(labels, dict):
        raise TypeError("metadata.labels must be a mapping")
    labels[LAB_LABEL_KEY] = LAB_LABEL_VALUE
    return labelled
