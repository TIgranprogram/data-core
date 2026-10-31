#!/usr/bin/env bash
# Туннель Sportin → VPS: 127.0.0.1:4203 на VPS ведёт на :3001 Sportin. Запуск с домашнего ПК, один раз:
#   bash SRV-ERP/setup-tunnel.sh
# Домен этот туннель НЕ переключает: прод работает как раньше.
# Ключ на VPS ограничен: без входа в оболочку, разрешён только порт 4203. Отозвать: удалить строку с sportin-tunnel
# из /root/.ssh/authorized_keys на VPS. Повторный запуск ничего не дублирует.
set -euo pipefail
ERP=(ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes -o ConnectTimeout=15 erpadmin@sportin.netcraze.pro)
VM=(ssh -i "$HOME/.ssh/kppdf80-vm" -o BatchMode=yes -o ConnectTimeout=15 tiit@192.168.1.52)

[[ "$("${ERP[@]}" hostname)" == "srv-erp" ]] || { echo "СТОП: это не сервер srv-erp"; exit 2; }

echo "== Ключ на Sportin"
"${ERP[@]}" '[ -f ~/.ssh/id_ed25519 ] || ssh-keygen -q -t ed25519 -N "" -C sportin-tunnel -f ~/.ssh/id_ed25519'
PUB="$("${ERP[@]}" 'cat ~/.ssh/id_ed25519.pub')"
[[ "$PUB" == ssh-ed25519\ * ]] || { echo "СТОП: нет открытого ключа"; exit 2; }

echo "== Разрешение на VPS"
TARGET="$("${VM[@]}" 'crontab -l | grep -o "VPS_TARGET=[^ ]*" | head -1 | cut -d= -f2')"
[[ -n "$TARGET" ]] || { echo "СТОП: адрес VPS не найден"; exit 2; }
KEY="$(echo "$PUB" | cut -d' ' -f2)"
LINE="restrict,port-forwarding,permitlisten=\"127.0.0.1:4203\" ssh-ed25519 $KEY sportin-tunnel"
printf '%s\n' "$LINE" | "${VM[@]}" "ssh -o BatchMode=yes '$TARGET' 'read -r L; f=/root/.ssh/authorized_keys; grep -qF \"$KEY\" \$f || printf \"%s\n\" \"\$L\" >> \$f'"

echo "== Запуск туннеля на Sportin"
"${ERP[@]}" "line='* * * * * VPS_TARGET=$TARGET REMOTE_PORT=4203 /bin/bash /opt/data-core/deploy/synology/datacore-tunnel.sh >/dev/null 2>&1'; (crontab -l 2>/dev/null | grep -v REMOTE_PORT=4203; echo \"\$line\") | crontab -"
"${ERP[@]}" "VPS_TARGET=$TARGET REMOTE_PORT=4203 nohup /bin/bash /opt/data-core/deploy/synology/datacore-tunnel.sh >/dev/null 2>&1 &" || true

echo "== Проверка с VPS"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  CODE="$("${VM[@]}" "ssh -o BatchMode=yes '$TARGET' 'curl -s -m 5 -o /dev/null -w %{http_code} http://127.0.0.1:4203/api/health/ready'" || true)"
  [[ "$CODE" == "200" ]] && { echo "Готово: туннель работает, health 200. Домен не менялся."; exit 0; }
  sleep 10
done
echo "СТОП: туннель не отвечает, код ${CODE:-нет}. Прод не затронут."; exit 1
