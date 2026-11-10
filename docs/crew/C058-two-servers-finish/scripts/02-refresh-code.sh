#!/usr/bin/env bash
# C058: обновить Sportin кодом+базой+фото из свежего tgz на ПК.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
TGZ=$(ls -t /d/datacore-backups/datacore-*.tgz | head -1)
echo "== Источник: $TGZ"
gzip -t "$TGZ"
echo "== gzip OK, bytes=$(wc -c < "$TGZ" | tr -d ' ')"
# страховка .env Sportin (без печати)
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes -o ConnectTimeout=20 erpadmin@sportin.netcraze.pro \
  'ts=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p /var/lib/datacore/backups/c058; cp -a /opt/data-core/.env /var/lib/datacore/backups/c058/env-$ts.bak; echo ENV_BAK_SPORTIN=$ts'
bash SRV-ERP/refresh-copy.sh --code
echo REFRESH_CODE_OK
