# Scoreboard

Generated on 2026-11-27 from 12 run files. Score (primary = F1 for q1-kev, cell accuracy for q2-msft); a run that did not complete scores 0.

## Summary

| Tool | Question | Runs | Mean | Min | Max | Recall | Precision | Vendor accuracy | Mentioned recall | Format failures | Mean wall time | Mean cost | Mean sources |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ldr | q1-kev | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 99.1% | 100.0% | 0 | 12:05 | $1.15 | 172.0 |
| gemini | q1-kev | 3 | 95.3% | 91.4% | 100.0% | 94.4% | 96.2% | 93.2% | 94.4% | 0 | 9:44 | $3.43 | 64.7 |
| ldr | q2-msft | 3 | 94.4% | 87.5% | 100.0% | n/a | n/a | n/a | n/a | 0 | 16:01 | $1.53 | 210.7 |
| gemini | q2-msft | 3 | 100.0% | 100.0% | 100.0% | n/a | n/a | n/a | n/a | 0 | 9:03 | $3.21 | 40.0 |

## Runs

| Tool | Question | Run | Status | Score | Format failure | Vendor accuracy | Mentioned recall | Wall time | Cost | Sources |
|---|---|---|---|---|---|---|---|---|---|---|
| ldr | q1-kev | 1 | completed | 100.0% | no | 100.0% | 100.0% | 11:55 | $1.14 | 209 |
| ldr | q1-kev | 2 | completed | 100.0% | no | 100.0% | 100.0% | 10:35 | $1.01 | 125 |
| ldr | q1-kev | 3 | completed | 100.0% | no | 97.2% | 100.0% | 13:45 | $1.31 | 182 |
| gemini | q1-kev | 1 | completed | 91.4% | no | 96.9% | 88.9% | 9:29 | $3.51 | 67 |
| gemini | q1-kev | 2 | completed | 94.4% | no | 88.2% | 94.4% | 9:12 | $3.75 | 47 |
| gemini | q1-kev | 3 | completed | 100.0% | no | 94.4% | 100.0% | 10:32 | $3.03 | 80 |
| ldr | q2-msft | 1 | completed | 87.5% | no | n/a | n/a | 17:48 | $1.70 | 160 |
| ldr | q2-msft | 2 | completed | 100.0% | no | n/a | n/a | 13:46 | $1.31 | 255 |
| ldr | q2-msft | 3 | completed | 95.8% | no | n/a | n/a | 16:29 | $1.57 | 217 |
| gemini | q2-msft | 1 | completed | 100.0% | no | n/a | n/a | 7:54 | $2.33 | 34 |
| gemini | q2-msft | 2 | completed | 100.0% | no | n/a | n/a | 10:32 | $4.76 | 48 |
| gemini | q2-msft | 3 | completed | 100.0% | no | n/a | n/a | 8:41 | $2.54 | 38 |

## Where it went wrong

### ldr q1-kev run 1

- nothing wrong

### ldr q1-kev run 2

- nothing wrong

### ldr q1-kev run 3

- Vendor mismatches: CVE-2026-46300 (answered Linux Kernel, truth Linux)

### gemini q1-kev run 1

- Missed: CVE-2026-0322, CVE-2026-104935, CVE-2026-109618, CVE-2026-109619
- Extra: CVE-2026-103849, CVE-2026-14742
- Vendor mismatches: CVE-2026-114625 (answered Arista Networks, truth Arista)

### gemini q1-kev run 2

- Missed: CVE-2026-105134, CVE-2026-110447
- Extra: CVE-2026-14742, CVE-2026-90817
- Vendor mismatches: CVE-2026-102489 (answered Zammad, truth Zammad GmbH), CVE-2026-102490 (answered Zammad, truth Zammad GmbH), CVE-2026-109618 (answered PHP, truth PHP Group), CVE-2026-109619 (answered PHP, truth PHP Group)

### gemini q1-kev run 3

- Vendor mismatches: CVE-2016-3081 (answered Apache Software Foundation, truth Apache), CVE-2026-46300 (answered Linux Kernel, truth Linux)

### ldr q2-msft run 1

- Wrong cells: 2025-09-30 net_income: none vs 27747, 2025-09-30 diluted_eps: 4.13 vs 3.72, 2025-12-31 diluted_eps: none vs 5.16

### ldr q2-msft run 2

- nothing wrong

### ldr q2-msft run 3

- Wrong cells: 2025-09-30 diluted_eps: 4.13 vs 3.72

### gemini q2-msft run 1

- nothing wrong

### gemini q2-msft run 2

- nothing wrong

### gemini q2-msft run 3

- nothing wrong
