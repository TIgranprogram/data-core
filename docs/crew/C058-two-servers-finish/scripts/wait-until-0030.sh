#!/usr/bin/env bash
# Ждать 00:30 местного времени (МСК на этом ПК).
set -euo pipefail
h=$(date +%H)
m=$(date +%M)
s=$(date +%S)
past=$((10#$h * 3600 + 10#$m * 60 + 10#$s))
target=$((0 * 3600 + 30 * 60))
if (( past < target )); then
  wait=$((target - past))
else
  wait=$((86400 - past + target))
fi
echo "NOW=$(date '+%Y-%m-%d %H:%M:%S %z') WAIT_SEC=$wait"
sleep "$wait"
echo "GO_0030 $(date '+%Y-%m-%d %H:%M:%S %z')"
