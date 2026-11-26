"""Reads and writes the committed answer-key files."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path

from app.answers.kev_answer import KevItem
from app.errors import TruthError
from app.logging_setup import Logger
from app.truth.edgar import MsftTruth, QuarterTruth
from app.truth.kev import KevTruth


def kev_truth_to_json(truth: KevTruth) -> dict[str, object]:
    """Converts the KEV answer key to its file payload."""
    return {
        "window_start": truth.window_start,
        "window_end": truth.window_end,
        "catalog_version": truth.catalog_version,
        "entries": [
            {"cve_id": e.cve_id, "vendor": e.vendor, "product": e.product}
            for e in truth.entries
        ],
    }


def msft_truth_to_json(truth: MsftTruth) -> dict[str, object]:
    """Converts the Microsoft answer key to its file payload."""
    return {
        "cik": truth.cik,
        "quarters": [
            {
                "quarter_end": q.quarter_end,
                "revenue_usd_millions": q.revenue_usd_millions,
                "net_income_usd_millions": q.net_income_usd_millions,
                "diluted_eps_usd": q.diluted_eps_usd,
                "derived": q.derived,
            }
            for q in truth.quarters
        ],
    }


def render_truth(payload: Mapping[str, object]) -> str:
    """Serialises a payload the way it is stored on disk."""
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def same_content(
    path: Path, payload: Mapping[str, object], *, ignore: tuple[str, ...] = ()
) -> bool:
    """True when the file holds `payload`, disregarding the top-level `ignore` keys."""
    try:
        stored = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if not isinstance(stored, dict):
        return False
    return _without(stored, ignore) == _without(payload, ignore)


def write_truth(
    path: Path,
    payload: Mapping[str, object],
    *,
    log: Logger,
    ignore: tuple[str, ...] = (),
) -> bool:
    """Writes the payload atomically; returns True when the file was rewritten.

    A file that differs only in the `ignore` keys is left untouched.
    """
    try:
        log.info("Writing answer key...", path=str(path))
        changed = not same_content(path, payload, ignore=ignore)
        if changed:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_name(f"{path.name}.tmp")
            temp.write_text(render_truth(payload), encoding="utf-8")
            temp.replace(path)
    except OSError as err:
        log.exception("Writing answer key failed.", path=str(path))
        raise TruthError(f"cannot write {path}: {err}") from err
    else:
        log.info("Writing answer key succeeded.", path=str(path), changed=changed)
        return changed


def _without(data: Mapping[str, object], ignore: tuple[str, ...]) -> dict[str, object]:
    return {key: value for key, value in data.items() if key not in ignore}


def load_kev_truth(path: Path) -> KevTruth:
    """Loads the committed KEV answer key."""
    data = _load(path)
    try:
        return KevTruth(
            window_start=str(data["window_start"]),
            window_end=str(data["window_end"]),
            catalog_version=str(data["catalog_version"]),
            entries=tuple(
                KevItem(str(e["cve_id"]), str(e["vendor"]), str(e["product"]))
                for e in _items(data["entries"])
            ),
        )
    except (KeyError, TypeError) as err:
        raise TruthError(f"{path} is not a KEV answer key") from err


def load_msft_truth(path: Path) -> MsftTruth:
    """Loads the committed Microsoft answer key."""
    data = _load(path)
    try:
        return MsftTruth(
            cik=str(data["cik"]),
            quarters=tuple(
                QuarterTruth(
                    quarter_end=str(q["quarter_end"]),
                    revenue_usd_millions=float(str(q["revenue_usd_millions"])),
                    net_income_usd_millions=float(str(q["net_income_usd_millions"])),
                    diluted_eps_usd=float(str(q["diluted_eps_usd"])),
                    derived=bool(q["derived"]),
                )
                for q in _items(data["quarters"])
            ),
        )
    except (KeyError, TypeError, ValueError) as err:
        raise TruthError(f"{path} is not a Microsoft answer key") from err


def _load(path: Path) -> dict[str, object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        raise TruthError(f"cannot read answer key {path}: {err}") from err
    if not isinstance(data, dict):
        raise TruthError(f"{path} does not hold a JSON object")
    return data


def _items(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list) or not all(isinstance(v, dict) for v in value):
        raise TypeError("expected a list of objects")
    return value
