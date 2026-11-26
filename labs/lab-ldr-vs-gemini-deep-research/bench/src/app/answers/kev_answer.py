"""Parses the CVE list a report answers question one with."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.answers.extract import extract_last_json_block

_CVE_ID = re.compile(r"CVE-\d{4}-\d{4,}", re.IGNORECASE)


@dataclass(frozen=True)
class KevItem:
    """One CVE the report claims was added to the catalog."""

    cve_id: str
    vendor: str
    product: str


def parse_kev_answer(report: str) -> tuple[KevItem, ...] | None:
    """Returns the listed CVEs, or None when the answer block is unusable."""
    root = extract_last_json_block(report)
    if not isinstance(root, dict):
        return None
    cves = root.get("cves")
    if not isinstance(cves, list):
        return None
    items: list[KevItem] = []
    for raw in cves:
        if not isinstance(raw, dict):
            continue
        cve_id = raw.get("cve_id")
        if not isinstance(cve_id, str) or not cve_id.strip():
            continue
        vendor = _text(raw.get("vendor"))
        product = _text(raw.get("product"))
        items.append(KevItem(cve_id, vendor, product))
    return tuple(items)


def mentioned_cves(report: str) -> frozenset[str]:
    """Returns every CVE id appearing anywhere in the report, upper-cased."""
    return frozenset(match.upper() for match in _CVE_ID.findall(report))


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""
