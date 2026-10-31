#!/usr/bin/env bash
# С ПК (из корня репо): сделать бэкап на Sportin сейчас (SRV-ERP/backup-erp.sh), не дожидаясь ночи.
# Нужен, чтобы «Отправить сейчас» на NAS не отвечало «Нет свежего бэкапа». Прод и VM не трогает.
set -euo pipefail
KEY="${KEY:-$HOME/.ssh/erp_server}"; HOST="${HOST:-erpadmin@sportin.netcraze.pro}"
echo "== Бэкап на втором сервере"
ssh -i "$KEY" -o BatchMode=yes "$HOST" 'bash /opt/data-core/SRV-ERP/backup-erp.sh && ls -1t /var/lib/datacore/backups/srv-erp-*.tgz | head -3'
echo "Готово. Теперь в админке Sportin нажмите «Отправить сейчас»."
