"""The fixed benchmark questions and the prompt each tool receives."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.errors import ConfigError

_CONTRACT_INTRO = (
    "Your report may be as long as you like, but it must end with exactly one "
    "fenced json code block (```json ... ```) matching this schema, with no "
    "text after it:"
)


@dataclass(frozen=True)
class Question:
    """One benchmark question and the answer schema it demands."""

    id: str
    text: str
    contract: str


QUESTIONS: tuple[Question, ...] = (
    Question(
        id="q1-kev",
        text=(
            "List every CVE that CISA added to its Known Exploited "
            "Vulnerabilities catalog between 2026-10-01 and 2026-10-31 "
            "(inclusive), with vendor and product."
        ),
        contract=(
            f"{_CONTRACT_INTRO}\n"
            '{"cves": [{"cve_id": "CVE-YYYY-NNNN", "vendor": "...", '
            '"product": "..."}]}'
        ),
    ),
    Question(
        id="q2-msft",
        text=(
            "For Microsoft's fiscal quarters ended 2024-12-31 through "
            "2026-09-30 (8 quarters), give GAAP revenue, GAAP net income and "
            "GAAP diluted EPS."
        ),
        contract=(
            f"{_CONTRACT_INTRO}\n"
            '{"quarters": [{"quarter_end": "YYYY-MM-DD", '
            '"revenue_usd_millions": n, "net_income_usd_millions": n, '
            '"diluted_eps_usd": n}]}'
        ),
    ),
)


def get_question(qid: str) -> Question:
    """Returns the question with this id."""
    for question in QUESTIONS:
        if question.id == qid:
            return question
    known = ", ".join(q.id for q in QUESTIONS)
    raise ConfigError(f"unknown question {qid!r}; known: {known}")


def select_questions(choice: str) -> tuple[Question, ...]:
    """Returns every question for "all", otherwise the single named one."""
    if choice == "all":
        return QUESTIONS
    return (get_question(choice),)


def build_prompt(question: Question, *, today: date) -> str:
    """Builds the full prompt: date line, question, answer contract."""
    date_line = f"Today's date is {today.isoformat()}."
    return f"{date_line}\n\n{question.text}\n\n{question.contract}"
