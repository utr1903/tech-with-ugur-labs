"""Parses the quarterly figures a report answers question two with."""

from __future__ import annotations

from dataclasses import dataclass

from app.answers.extract import extract_last_json_block


@dataclass(frozen=True)
class QuarterRow:
    """One reported quarter; a metric is None when it could not be read."""

    quarter_end: str
    revenue_usd_millions: float | None
    net_income_usd_millions: float | None
    diluted_eps_usd: float | None


def parse_msft_answer(report: str) -> tuple[QuarterRow, ...] | None:
    """Returns the reported quarters, or None when the answer block is unusable."""
    root = extract_last_json_block(report)
    if not isinstance(root, dict):
        return None
    quarters = root.get("quarters")
    if not isinstance(quarters, list):
        return None
    rows: list[QuarterRow] = []
    for raw in quarters:
        if not isinstance(raw, dict):
            continue
        quarter_end = raw.get("quarter_end")
        if not isinstance(quarter_end, str):
            continue
        rows.append(
            QuarterRow(
                quarter_end=quarter_end.strip(),
                revenue_usd_millions=_to_number(raw.get("revenue_usd_millions")),
                net_income_usd_millions=_to_number(raw.get("net_income_usd_millions")),
                diluted_eps_usd=_to_number(raw.get("diluted_eps_usd")),
            )
        )
    return tuple(rows)


def _to_number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace("$", "").replace(",", "").replace(" ", "")
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None
