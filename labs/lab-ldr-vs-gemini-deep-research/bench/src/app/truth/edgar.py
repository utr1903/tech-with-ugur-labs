"""The Microsoft answer key: quarterly figures from SEC XBRL company facts."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date

from app.errors import TruthError

MSFT_QUARTER_ENDS = (
    date(2024, 12, 31),
    date(2025, 3, 31),
    date(2025, 6, 30),
    date(2025, 9, 30),
    date(2025, 12, 31),
    date(2026, 3, 31),
    date(2026, 6, 30),
    date(2026, 9, 30),
)

REVENUE_TAG = "RevenueFromContractWithCustomerExcludingAssessedTax"
NET_INCOME_TAG = "NetIncomeLoss"
EPS_TAG = "EarningsPerShareDiluted"

_QUARTER_DAYS = range(80, 101)
_NINE_MONTH_DAYS = range(260, 291)
_ANNUAL_DAYS = range(350, 381)
_FORMS = frozenset({"10-Q", "10-K"})

type _Periods = dict[tuple[date, date], float]


@dataclass(frozen=True)
class QuarterTruth:
    """One fiscal quarter. `derived` marks a value computed as annual - 9 months."""

    quarter_end: str
    revenue_usd_millions: float
    net_income_usd_millions: float
    diluted_eps_usd: float
    derived: bool


@dataclass(frozen=True)
class MsftTruth:
    """The answer key for the Microsoft question."""

    cik: str
    quarters: tuple[QuarterTruth, ...]


def build_msft_truth(
    companyfacts: Mapping[str, object], *, quarter_ends: tuple[date, ...]
) -> MsftTruth:
    """Resolves revenue, net income and diluted EPS for each requested quarter."""
    revenue = _periods(companyfacts, REVENUE_TAG, "USD")
    income = _periods(companyfacts, NET_INCOME_TAG, "USD")
    eps = _periods(companyfacts, EPS_TAG, "USD/shares")
    quarters = []
    for end in quarter_ends:
        rev, rev_derived = _quarter_value(revenue, end, REVENUE_TAG, digits=None)
        net, net_derived = _quarter_value(income, end, NET_INCOME_TAG, digits=None)
        per_share, eps_derived = _quarter_value(eps, end, EPS_TAG, digits=2)
        quarters.append(
            QuarterTruth(
                quarter_end=end.isoformat(),
                revenue_usd_millions=rev / 1e6,
                net_income_usd_millions=net / 1e6,
                diluted_eps_usd=per_share,
                derived=rev_derived or net_derived or eps_derived,
            )
        )
    return MsftTruth(cik=_cik(companyfacts), quarters=tuple(quarters))


def _cik(companyfacts: Mapping[str, object]) -> str:
    try:
        return f"{int(str(companyfacts['cik'])):010d}"
    except (KeyError, ValueError) as err:
        raise TruthError("company facts have no usable 'cik'") from err


def _periods(companyfacts: Mapping[str, object], tag: str, unit: str) -> _Periods:
    """Maps (start, end) to the value of the latest-filed 10-Q/10-K row."""
    rows = _rows(companyfacts, tag, unit)
    latest: dict[tuple[date, date], tuple[str, float]] = {}
    for row in rows:
        if row.get("form") not in _FORMS:
            continue
        try:
            key = (
                date.fromisoformat(str(row["start"])),
                date.fromisoformat(str(row["end"])),
            )
            filed, value = str(row["filed"]), float(str(row["val"]))
        except (KeyError, ValueError, TypeError) as err:
            raise TruthError(f"{tag}: malformed fact row {row!r}") from err
        if key not in latest or filed > latest[key][0]:
            latest[key] = (filed, value)
    return {key: value for key, (_, value) in latest.items()}


def _rows(
    companyfacts: Mapping[str, object], tag: str, unit: str
) -> list[dict[str, object]]:
    node: object = companyfacts
    for part in ("facts", "us-gaap", tag, "units", unit):
        if not isinstance(node, dict) or part not in node:
            raise TruthError(f"company facts have no {tag} data in {unit}")
        node = node[part]
    if not isinstance(node, list):
        raise TruthError(f"{tag}: facts for {unit} are not a list")
    return [row for row in node if isinstance(row, dict)]


def _quarter_value(
    periods: _Periods, end: date, tag: str, *, digits: int | None
) -> tuple[float, bool]:
    """Returns (value, derived) for the quarter ending on `end`."""
    for (start, stop), value in periods.items():
        if stop == end and (stop - start).days in _QUARTER_DAYS:
            return value, False
    for (start, stop), annual in periods.items():
        if stop == end and (stop - start).days in _ANNUAL_DAYS:
            nine_months = _nine_months(periods, start)
            if nine_months is not None:
                result = annual - nine_months
                return (result if digits is None else round(result, digits)), True
    raise TruthError(f"{tag}: no reported or derivable value for quarter ending {end}")


def _nine_months(periods: _Periods, start: date) -> float | None:
    for (first, stop), value in periods.items():
        if first == start and (stop - first).days in _NINE_MONTH_DAYS:
            return value
    return None
