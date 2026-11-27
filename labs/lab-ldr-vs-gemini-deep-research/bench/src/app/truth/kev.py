"""The CISA KEV answer key: CVEs added to the catalog inside a date window."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date

from app.answers.kev_answer import KevItem
from app.errors import TruthError

KEV_WINDOW = (date(2026, 10, 1), date(2026, 10, 31))


@dataclass(frozen=True)
class KevTruth:
    """Every CVE added to the catalog inside the window, sorted by id."""

    window_start: str
    window_end: str
    catalog_version: str
    entries: tuple[KevItem, ...]


def build_kev_truth(feed: Mapping[str, object], *, start: date, end: date) -> KevTruth:
    """Keeps the feed entries whose dateAdded lies in [start, end]."""
    vulnerabilities = feed.get("vulnerabilities")
    if not isinstance(vulnerabilities, list):
        raise TruthError("KEV feed has no 'vulnerabilities' list")

    entries: dict[str, KevItem] = {}
    for raw in vulnerabilities:
        item = _entry_in_window(raw, start=start, end=end)
        if item is not None:
            entries[item.cve_id] = item
    return KevTruth(
        window_start=start.isoformat(),
        window_end=end.isoformat(),
        catalog_version=str(feed.get("catalogVersion", "")),
        entries=tuple(entries[cve_id] for cve_id in sorted(entries)),
    )


def _entry_in_window(raw: object, *, start: date, end: date) -> KevItem | None:
    if not isinstance(raw, dict):
        raise TruthError(f"KEV feed entry is not an object: {raw!r}")
    try:
        added = date.fromisoformat(str(raw["dateAdded"]))
        cve_id = str(raw["cveID"]).strip().upper()
        vendor = str(raw["vendorProject"])
        product = str(raw["product"])
    except (KeyError, ValueError) as err:
        raise TruthError(f"KEV feed entry is malformed: {raw!r}") from err
    if not start <= added <= end:
        return None
    return KevItem(cve_id, vendor, product)
