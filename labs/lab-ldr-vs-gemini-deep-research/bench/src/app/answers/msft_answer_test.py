from __future__ import annotations

from app.answers.msft_answer import QuarterRow, parse_msft_answer


def _report(body: str) -> str:
    return f"```json\n{body}\n```"


def test_plain_numbers() -> None:
    body = (
        '{"quarters": [{"quarter_end": "2024-12-31", "revenue_usd_millions": 69632,'
        ' "net_income_usd_millions": 24108.5, "diluted_eps_usd": 3.23}]}'
    )
    assert parse_msft_answer(_report(body)) == (
        QuarterRow("2024-12-31", 69632.0, 24108.5, 3.23),
    )


def test_formatted_strings_are_coerced() -> None:
    body = (
        '{"quarters": [{"quarter_end": "2024-12-31", "revenue_usd_millions": "69,632",'
        ' "net_income_usd_millions": "24,108", "diluted_eps_usd": "$3.23"}]}'
    )
    rows = parse_msft_answer(_report(body))
    assert rows == (QuarterRow("2024-12-31", 69632.0, 24108.0, 3.23),)


def test_unparseable_cell_is_none_but_row_kept() -> None:
    body = (
        '{"quarters": [{"quarter_end": "2024-12-31", "revenue_usd_millions": "n/a",'
        ' "net_income_usd_millions": 1, "diluted_eps_usd": true}]}'
    )
    assert parse_msft_answer(_report(body)) == (
        QuarterRow("2024-12-31", None, 1.0, None),
    )


def test_missing_quarters_key_is_format_failure() -> None:
    assert parse_msft_answer(_report('{"other": []}')) is None
