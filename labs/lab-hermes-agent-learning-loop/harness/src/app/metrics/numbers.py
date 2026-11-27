"""Typed readers for the loosely typed parts of a run record."""

from __future__ import annotations

from app.cells.record import CellRecord


def num(value: object) -> float:
    """`value` as a float; anything non-numeric counts as 0."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return 0.0
    return float(value)


def mapping(value: object) -> dict[str, object]:
    """`value` as a string-keyed dict, empty if it is not one."""
    if not isinstance(value, dict):
        return {}
    return {str(k): v for k, v in value.items()}


def _pair(tokens: dict[str, int]) -> int:
    return tokens.get("input", 0) + tokens.get("output", 0)


def main_tokens(rec: CellRecord) -> tuple[int, int]:
    """(parent, children) tokens of the main turn."""
    return _pair(rec.parent_tokens), _pair(rec.children_tokens)


def _block_tokens(block: dict[str, object] | None) -> tuple[int, int]:
    """(input, output) of a review or follow-up block, children included."""
    data = mapping(block)
    kids = mapping(data.get("children_tokens"))
    return (
        int(num(data.get("input_tokens")) + num(kids.get("input"))),
        int(num(data.get("output_tokens")) + num(kids.get("output"))),
    )


def overhead_io(rec: CellRecord) -> tuple[int, int]:
    """(input, output) of the follow-up turn and both background reviews."""
    parts = [
        _block_tokens(rec.follow_up),
        _block_tokens(rec.review),
        _block_tokens(rec.follow_up_review),
    ]
    return sum(p[0] for p in parts), sum(p[1] for p in parts)


def total_io(rec: CellRecord) -> tuple[int, int]:
    """(input, output) of everything the cell spent."""
    o_in, o_out = overhead_io(rec)
    return (
        rec.parent_tokens.get("input", 0) + rec.children_tokens.get("input", 0) + o_in,
        rec.parent_tokens.get("output", 0)
        + rec.children_tokens.get("output", 0)
        + o_out,
    )
