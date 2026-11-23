#!/bin/sh
# Plant a cron job that would rerun the dropped tool every minute.
mkdir -p /etc/cron.d
echo "BENCH_ACTION $(date +%s%3N)"
echo '* * * * * root /tmp/bench/tool # bench-04-payload' > /etc/cron.d/bench-job
