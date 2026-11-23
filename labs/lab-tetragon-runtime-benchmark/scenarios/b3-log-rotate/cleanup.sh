#!/bin/sh
mkdir -p /tmp/bench /var/log/app
cd /var/log/app || exit 1
echo current > app.log
echo previous > app.log.1
echo oldest > app.log.2
