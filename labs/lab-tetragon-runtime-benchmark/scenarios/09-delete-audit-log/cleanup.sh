#!/bin/sh
mkdir -p /tmp/bench /var/log/app
echo 'audit: user=app action=login' > /var/log/app/audit.log
