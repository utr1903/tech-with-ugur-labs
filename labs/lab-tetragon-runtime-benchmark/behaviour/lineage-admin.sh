#!/bin/sh
# An administrator opening a shell in the web app pod: not a child of Python.
echo "BENCH_ACTION $(date +%s%3N)"
sh -c id
