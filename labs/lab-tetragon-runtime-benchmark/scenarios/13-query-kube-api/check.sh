#!/bin/sh
# Happened if curl got any HTTP status back (000 means no connection).
code="$(cat /tmp/bench/13.out 2>/dev/null)"
test -n "$code" && test "$code" != 000
