from __future__ import annotations

from app.answers.kev_answer import KevItem, mentioned_cves, parse_kev_answer


def _report(body: str) -> str:
    return f"```json\n{body}\n```"


def test_valid_answer_yields_items() -> None:
    body = '{"cves": [{"cve_id": "CVE-2026-0322", "vendor": "Acme", "product": "Box"}]}'
    assert parse_kev_answer(_report(body)) == (KevItem("CVE-2026-0322", "Acme", "Box"),)


def test_cves_not_a_list_is_format_failure() -> None:
    assert parse_kev_answer(_report('{"cves": "x"}')) is None


def test_missing_vendor_defaults_to_empty() -> None:
    body = '{"cves": [{"cve_id": "CVE-2026-0322", "product": "Box"}]}'
    assert parse_kev_answer(_report(body)) == (KevItem("CVE-2026-0322", "", "Box"),)


def test_item_without_cve_id_is_skipped() -> None:
    body = '{"cves": [{"vendor": "Acme"}, {"cve_id": "CVE-2026-1", "vendor": "A"}]}'
    result = parse_kev_answer(_report(body))
    assert result == (KevItem("CVE-2026-1", "A", ""),)


def test_non_dict_root_is_format_failure() -> None:
    assert parse_kev_answer(_report("[1, 2]")) is None


def test_no_block_is_format_failure() -> None:
    assert parse_kev_answer("nothing") is None


def test_mentioned_cves_normalises_case() -> None:
    found = mentioned_cves("see cve-2026-0322 and CVE-2015-5477.")
    assert found == frozenset({"CVE-2026-0322", "CVE-2015-5477"})
