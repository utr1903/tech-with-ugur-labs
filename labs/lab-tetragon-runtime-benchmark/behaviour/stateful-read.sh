#!/bin/sh
# Read the credential file and do nothing else.
echo "BENCH_ACTION $(date +%s%3N)"
cat /etc/lab/credentials > /dev/null
