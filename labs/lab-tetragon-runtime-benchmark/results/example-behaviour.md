# Behaviour demos

| Demo | Case | Expected | Seen | Verdict | Detail |
|---|---|---|---|---|---|
| lineage | rce | alert | alert | ok | policy events: __arm64_sys_execve |
| lineage | admin | no alert | no alert | ok | policy events: none |
| stateful | connect-only | no alert | no alert | ok | policy events: none |
| stateful | read-only | no alert | no alert | ok | policy events: security_file_open |
| stateful | read-then-connect | alert | alert | ok | policy events: security_file_open, tcp_connect |
| sigkill-vs-override | sigkill | alert | alert | ok | rm rc 137, file gone; policy events: __arm64_sys_unlinkat |
| sigkill-vs-override | override | alert | alert | ok | rm rc 1, file remains; policy events: __arm64_sys_unlinkat |

**Lesson:** Sigkill kills rm, but the file is already gone: the kill does not stop the deletion. Override makes the unlink syscall itself fail, so the file survives.

All behaviour cases matched their expectation.
