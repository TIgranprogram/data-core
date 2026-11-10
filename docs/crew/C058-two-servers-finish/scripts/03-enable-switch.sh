#!/usr/bin/env bash
# C058 A1: setup-switch --enable (HA_SELF + cron моста). Идемпотентен.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
bash SRV-ERP/setup-switch.sh --enable
echo ENABLE_OK
