#!/usr/bin/env bash
# С ПК (из корня репо): отправить SRV-ERP на второй сервер и установить SMB-копии (install-smb.sh --with-backup).
# Повторный запуск безопасен: install-smb.sh ничего не дублирует. Прод и VM не трогает.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
KEY="${KEY:-$HOME/.ssh/erp_server}"; HOST="${HOST:-erpadmin@sportin.netcraze.pro}"
echo "== Отправка SRV-ERP на второй сервер"
tar -cf - SRV-ERP --exclude='SRV-ERP/access-package' --exclude='SRV-ERP/connect.txt' | ssh -i "$KEY" -o BatchMode=yes "$HOST" 'tar -xf - -C /opt/data-core'
echo "== Установка SMB-копий"
ssh -i "$KEY" -o BatchMode=yes "$HOST" 'bash /opt/data-core/SRV-ERP/install-smb.sh --with-backup'
echo "== Готово. Дальше: админка второго сервера → Сервер → Копии вне дома → Добавить место → Сетевая папка (SMB)"
