from __future__ import annotations

from datetime import date

import pytest

from app.errors import ConfigError
from app.questions.catalog import build_prompt, get_question, select_questions


def test_build_prompt_has_date_question_and_contract() -> None:
    prompt = build_prompt(get_question("q1-kev"), today=date(2026, 11, 26))
    assert prompt.startswith("Today's date is 2026-11-26.")
    assert "2026-10-01 and 2026-10-31" in prompt
    assert '"cves"' in prompt


def test_select_all_returns_both_questions() -> None:
    assert tuple(q.id for q in select_questions("all")) == ("q1-kev", "q2-msft")


def test_select_one_returns_that_question() -> None:
    assert tuple(q.id for q in select_questions("q2-msft")) == ("q2-msft",)


def test_unknown_id_raises_config_error() -> None:
    with pytest.raises(ConfigError):
        get_question("q9-nope")
