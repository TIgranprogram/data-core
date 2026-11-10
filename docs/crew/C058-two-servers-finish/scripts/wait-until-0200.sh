#!/usr/bin/env bash
set -eu
h=$(date +%H); m=$(date +%M); s=$(date +%S)
past=$((10#$h * 3600 + 10#$m * 60 + 10#$s))
target=$((2 * 3600))
if (( past < target )); then wait=$((target - past)); else wait=0; fi
echo "NOW=$(date '+%Y-%m-%d %H:%M:%S %z') WAIT_SEC=$wait until 02:00"
sleep "$wait"
echo "GO_0200 $(date '+%Y-%m-%d %H:%M:%S %z')"
