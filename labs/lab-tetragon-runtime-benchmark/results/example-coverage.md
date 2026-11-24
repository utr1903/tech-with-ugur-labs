| # | Technique | Scenario | Tactic | default | tuned | enforce | median latency (tuned) |
|---|---|---|---|---|---|---|---|
| 01 | T1059.004 | Shell spawned by a Python process | Execution | missed | detected 3/3 | blocked 3/3 | 18 ms |
| 02 | T1105 | Download a tool to /tmp and run it | Command and Control | detected 3/3 | detected 3/3 | blocked 3/3 | 1 ms |
| 03 | T1620 | Fileless exec from a memfd | Defense Evasion | detected 3/3 | detected 3/3 | blocked 3/3 | 8 ms |
| 04 | T1053.003 | Write a cron job to /etc/cron.d | Persistence | missed | detected 3/3 | blocked 3/3 | 0 ms |
| 05 | T1098.004 | Append a key to root's authorized_keys | Persistence | missed | detected 3/3 | blocked 3/3 | 0 ms |
| 06 | T1548.001 | Set the setuid bit on a copied binary | Privilege Escalation | missed | detected 3/3 | blocked 3/3 | 1 ms |
| 07 | T1611 | Enter the host's mount namespace with nsenter | Privilege Escalation | detected 3/3 | detected 3/3 | blocked 3/3 | 1 ms |
| 08 | T1547.006 | Load a kernel module | Persistence | missed | detected 3/3 | blocked 3/3 | 0 ms |
| 09 | T1070.004 | Delete an application audit log | Defense Evasion | missed | detected 3/3 | blocked 3/3 | 1 ms |
| 10 | T1562.001 | Load an eBPF program | Defense Evasion | missed | detected 3/3 | blocked 3/3 | 1 ms |
| 11 | T1003.008 | Read /etc/shadow | Credential Access | missed | detected 3/3 | blocked 3/3 | 1 ms |
| 12 | T1552.001 | Read the service-account token | Credential Access | missed | detected 3/3 | blocked 3/3 | 1 ms |
| 13 | T1613 | Query the Kubernetes API with the pod's token | Discovery | missed | detected 3/3 | blocked 3/3 | 9 ms |
| 14 | T1571 | Reverse shell to the attacker on port 4444 | Command and Control | missed | detected 3/3 | blocked 3/3 | 31 ms |
| 15 | T1496 | Cryptominer stratum beacon to port 3333 | Impact | missed | detected 3/3 | blocked 3/3 | 14 ms |

## False positives (benign scenarios)

- none

## Recall

- default: 3/15 attack scenarios detected
- tuned: 15/15 attack scenarios detected
- enforce: 15/15 attack scenarios blocked

## Failures

- none
