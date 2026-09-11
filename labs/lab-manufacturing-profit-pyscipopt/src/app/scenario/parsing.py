"""Small schema primitives for named YAML maps."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TypeGuard

import numpy as np

from app.contracts import FloatArray
from app.errors import ScenarioError

type Node = Mapping[str, object]


def mapping(value: object, field_path: str) -> Node:
    """Require a string-keyed mapping."""
    if not isinstance(value, Mapping) or not all(isinstance(key, str) for key in value):
        raise ScenarioError(f"{field_path}: expected a named mapping")
    return value


def require_keys(value: object, expected: tuple[str, ...], field_path: str) -> Node:
    """Require exactly the expected keys and report the precise difference."""
    node = mapping(value, field_path)
    missing = [key for key in expected if key not in node]
    if missing:
        raise ScenarioError(f"{field_path}.{missing[0]}: required field is missing")
    extra = [key for key in node if key not in expected]
    if extra:
        raise ScenarioError(f"{field_path}.{extra[0]}: unknown field")
    return node


def is_number(value: object) -> TypeGuard[int | float]:
    """Identify ordinary finite numeric YAML scalars, excluding booleans."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def number(value: object, field_path: str) -> float:
    """Convert one finite numeric scalar to float."""
    if not is_number(value):
        raise ScenarioError(f"{field_path}: expected a number, not a boolean or text")
    result = float(value)
    if not np.isfinite(result):
        raise ScenarioError(f"{field_path}: expected a finite number")
    return result


def tensor(
    value: object,
    field_path: str,
    axes: tuple[tuple[str, ...], ...],
) -> FloatArray:
    """Convert nested named axes to a finite, immutable float array."""

    def visit(current: object, depth: int, path: str) -> object:
        if depth == len(axes):
            return number(current, path)
        names = axes[depth]
        node = require_keys(current, names, path)
        return [visit(node[name], depth + 1, f"{path}.{name}") for name in names]

    result = np.array(visit(value, 0, field_path), dtype=np.float64, copy=True)
    result.flags.writeable = False
    return result


def vector(value: object, field_path: str) -> FloatArray:
    """Convert a YAML sequence to a finite, immutable float vector."""
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise ScenarioError(f"{field_path}: expected a numeric sequence")
    result = np.array(
        [number(item, f"{field_path}[{index}]") for index, item in enumerate(value)],
        dtype=np.float64,
        copy=True,
    )
    result.flags.writeable = False
    return result
