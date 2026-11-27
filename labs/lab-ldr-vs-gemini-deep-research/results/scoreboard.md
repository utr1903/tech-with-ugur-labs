# Scoreboard

Generated on 2026-11-27 from 2 run files. Score (primary = F1 for q1-kev, cell accuracy for q2-msft); a run that did not complete scores 0.

## Summary

| Tool | Question | Runs | Mean | Min | Max | Recall | Precision | Format failures | Mean wall time | Mean cost | Mean sources |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ldr | q1-kev | 1 | 10.5% | 10.5% | 10.5% | 5.6% | 100.0% | 0 | 13:27 | $1.28 | 4.0 |
| gemini | q1-kev | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 8:10 | $4.05 | 0.0 |

## Runs

| Tool | Question | Run | Status | Score | Format failure | Wall time | Cost | Sources |
|---|---|---|---|---|---|---|---|---|
| ldr | q1-kev | 1 | completed | 10.5% | no | 13:27 | $1.28 | 4 |
| gemini | q1-kev | 1 | completed | 100.0% | no | 8:10 | $4.05 | 0 |

## Where it went wrong

### ldr q1-kev run 1

- Missed: CVE-2015-3306, CVE-2015-5477, CVE-2016-3081, CVE-2021-3199, CVE-2023-22894, CVE-2025-61624, CVE-2026-0322, CVE-2026-102489, CVE-2026-102490, CVE-2026-102764, … and 24 more
- Vendor mismatches: CVE-2026-109618 (answered PHP, truth PHP Group), CVE-2026-109619 (answered PHP, truth PHP Group)

### gemini q1-kev run 1

- Vendor mismatches: CVE-2026-109618 (answered PHP, truth PHP Group), CVE-2026-109619 (answered PHP, truth PHP Group)
