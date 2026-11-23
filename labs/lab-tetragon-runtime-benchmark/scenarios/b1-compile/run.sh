#!/bin/sh
# Ordinary build work: gcc writes temp files to /tmp and runs its own tools.
mkdir -p /tmp/bench
echo "BENCH_ACTION $(date +%s%3N)"
gcc -o /build/hello /build/hello.c && /build/hello > /tmp/bench/b1.out
