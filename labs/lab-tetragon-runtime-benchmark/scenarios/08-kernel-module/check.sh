#!/bin/sh
# Happened if the kernel's module loader saw the file: any recorded result
# other than EPERM (normally ENOEXEC, because the module is garbage).
result="$(cat /tmp/bench/08.result 2>/dev/null)"
test -n "$result" && test "$result" != EPERM
