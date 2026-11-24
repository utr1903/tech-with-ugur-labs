#!/bin/sh
# Ordinary admin query: list installed packages.
mkdir -p /tmp/bench || exit 1
echo "BENCH_ACTION $(date +%s%3N)"
dpkg -l > /tmp/bench/b2.out
