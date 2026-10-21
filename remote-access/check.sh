#!/usr/bin/env bash
# Проверка связи с рабочего ПК: VPS → домашний сервер → сайт. Ничего не меняет.
# Запуск:  bash remote-access/check.sh
ok=1
printf '1. VPS (kppdf-crm.ru:22) отвечает: '
if timeout 10 bash -c 'exec 3<>/dev/tcp/kppdf-crm.ru/22' 2>/dev/null; then echo OK
else echo "НЕТ — с этой сети порт 22 закрыт (см. README «Если порт 22 закрыт»)"; ok=0; fi

printf '2. Вход на домашний сервер: '
if out=$(ssh -o BatchMode=yes -o ConnectTimeout=15 datacore-vm 'echo OK; cd /opt/data-core && docker ps --format "{{.Names}}" | grep -c datacore' 2>&1); then
  echo "OK (контейнеров data-core: $(tail -1 <<<"$out"))"
else
  echo "НЕТ — $(tail -1 <<<"$out")"; ok=0
fi

printf '3. Сайт https://kppdf-crm.ru/db/api/health/ready: '
code=$(curl -s -o /dev/null -w "%{http_code}" https://kppdf-crm.ru/db/api/health/ready); echo "$code"; [[ "$code" == 200 ]] || ok=0

printf '4. Место на диске сервера: '
if d=$(ssh -o BatchMode=yes -o ConnectTimeout=15 datacore-vm 'df -h /var/lib/datacore | tail -1' 2>/dev/null); then
  echo "$d" | awk '{print "занято " $3 " из " $2 " (" $5 "), свободно " $4}'
  pct=$(echo "$d" | awk '{gsub("%","",$5); print $5}'); [[ "${pct:-0}" -gt 90 ]] && echo "   ВНИМАНИЕ: занято больше 90% — освободите место до выкладки"
else echo "не удалось узнать"; fi

[[ $ok == 1 ]] && echo "== Всё на связи, можно выкладывать: bash remote-access/deploy.sh" || { echo "== Есть проблемы — см. выше"; exit 1; }
