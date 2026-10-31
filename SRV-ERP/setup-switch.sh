#!/usr/bin/env bash
# Подготовка кнопки «Переключить сейчас» (HA-TWO-SERVERS, SW-3/SW-5). Запуск человеком, один раз, из корня репо:
#   bash SRV-ERP/setup-switch.sh            # подготовка: переключатель на VPS, ключи, bridge.env; сайт не меняется
#   bash SRV-ERP/setup-switch.sh --enable   # + HA_SELF в .env обоих серверов и cron моста (кнопка заработает после выкладки)
# Работает и с домашнего, и с рабочего ПК:
#   VM:     если в ~/.ssh/config есть `datacore-vm` (рабочий ПК, remote-access/README.md) — ходим через него,
#           иначе дома tiit@192.168.1.52 с ключом ~/.ssh/kppdf80-vm;
#   Sportin: нужен ключ ~/.ssh/erp_server; нет его — скрипт останавливается ДО любых изменений и говорит, что сделать.
# Идемпотентен: повторный запуск ничего не дублирует. Сначала проверяются ВСЕ узлы, потом первые изменения.
# Что меняется на VPS: ставится /usr/local/bin/dc-switch, три ключа с ограничениями, в блоке /db/ файла kppdf-proxy
# `proxy_pass http://127.0.0.1:4201/` → `http://datacore_db/` (upstream в /etc/nginx/datacore-upstream.conf, значение 4201 —
# то же, что было). Перед правкой — копия kppdf-proxy.bak-switch-<время>; nginx -t; ошибка — откат. `location /` kppdf не трогается.
# Ключи: dc_switch (VPS: ТОЛЬКО dc-switch), dc_hop (VPS: только проброс на 127.0.0.1:4222 → ssh VM), dc_transfer (VM↔Sportin, restrict).
set -uo pipefail
ENABLE=0; [[ "${1:-}" == "--enable" ]] && ENABLE=1
cd "$(git rev-parse --show-toplevel)"
DOMAIN="${DOMAIN:-kppdf-crm.ru}"
NGINX_SITE="${NGINX_SITE:-}"
ERP_KEY="${ERP_KEY:-$HOME/.ssh/erp_server}"; ERP_HOST="${ERP_HOST:-erpadmin@sportin.netcraze.pro}"
SSHO=(-o BatchMode=yes -o ConnectTimeout=15)

say() { printf '%s\n' "$*"; }
problems=()

# ---------- 0. связь со всеми узлами (ничего не меняем) ----------
say "== Проверка связи"
VM=()
if grep -qE '^[[:space:]]*Host[[:space:]]+(.*[[:space:]])?datacore-vm([[:space:]]|$)' "$HOME/.ssh/config" 2>/dev/null \
   && ssh "${SSHO[@]}" datacore-vm 'echo ok' 2>/dev/null | grep -q ok; then
  VM=(ssh "${SSHO[@]}" datacore-vm); VM_WHERE="через datacore-vm (рабочий ПК)"
elif [[ -f "$HOME/.ssh/kppdf80-vm" ]] && ssh "${SSHO[@]}" -i "$HOME/.ssh/kppdf80-vm" tiit@192.168.1.52 'echo ok' 2>/dev/null | grep -q ok; then
  VM=(ssh "${SSHO[@]}" -i "$HOME/.ssh/kppdf80-vm" tiit@192.168.1.52); VM_WHERE="напрямую по домашней сети"
else
  problems+=("VM недоступна. Дома: нужны ключ ~/.ssh/kppdf80-vm и домашняя сеть. На работе: настройте remote-access/setup-work-pc.sh (вход datacore-vm).")
fi

ERP=()
if [[ ! -f "$ERP_KEY" ]]; then
  problems+=("Нет ключа ~/.ssh/erp_server для Sportin. Скопируйте его с домашнего ПК или запустите скрипт дома.")
elif ssh "${SSHO[@]}" -i "$ERP_KEY" "$ERP_HOST" hostname 2>/dev/null | grep -qx srv-erp; then
  ERP=(ssh "${SSHO[@]}" -i "$ERP_KEY" "$ERP_HOST")
else
  problems+=("Sportin (srv-erp) не отвечает по ключу erp_server: выключен, нет интернета или другой сервер.")
fi

TARGET=""
if [[ ${#VM[@]} -gt 0 ]]; then
  TARGET="$("${VM[@]}" 'crontab -l 2>/dev/null | grep -o "VPS_TARGET=[^ ]*" | head -1 | cut -d= -f2')"
  if [[ -z "$TARGET" ]]; then problems+=("На VM в расписании нет VPS_TARGET: адрес VPS не найден.")
  elif ! "${VM[@]}" "ssh -o BatchMode=yes -o ConnectTimeout=15 '$TARGET' 'echo ok'" 2>/dev/null | grep -q ok; then
    problems+=("VPS ($TARGET) не отвечает с VM.")
  fi
fi

if [[ ${#problems[@]} -gt 0 ]]; then
  say "СТОП. Ничего не изменено. Что нужно:"
  for p in "${problems[@]}"; do say " - $p"; done
  exit 2
fi
say "VM: $VM_WHERE · Sportin: ok · VPS: ok"

on_vm()  { "${VM[@]}" 'bash -s'; }
on_erp() { "${ERP[@]}" 'bash -s'; }
on_vps() { "${VM[@]}" "ssh -o BatchMode=yes -o ConnectTimeout=15 '$TARGET' 'bash -s'"; }

# ---------- 1. ключи на VM и Sportin ----------
say "== Ключи на VM и Sportin"
GEN='mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"; for k in "$@"; do [ -f "$HOME/.ssh/$k" ] || ssh-keygen -q -t ed25519 -N "" -C "$k-$(hostname)" -f "$HOME/.ssh/$k"; done'
printf 'set -e\nset -- dc_switch dc_transfer\n%s\n' "$GEN" | on_vm
printf 'set -e\nset -- dc_switch dc_transfer dc_hop\n%s\n' "$GEN" | on_erp
vm_pub()  { "${VM[@]}" "cut -d' ' -f2 \$HOME/.ssh/$1.pub"; }
erp_pub() { "${ERP[@]}" "cut -d' ' -f2 \$HOME/.ssh/$1.pub"; }
K_VM_SWITCH="$(vm_pub dc_switch)"; K_VM_TRANSFER="$(vm_pub dc_transfer)"
K_ERP_SWITCH="$(erp_pub dc_switch)"; K_ERP_TRANSFER="$(erp_pub dc_transfer)"; K_ERP_HOP="$(erp_pub dc_hop)"
for k in "$K_VM_SWITCH" "$K_VM_TRANSFER" "$K_ERP_SWITCH" "$K_ERP_TRANSFER" "$K_ERP_HOP"; do
  [[ ${#k} -gt 40 ]] || { say "СТОП: ключ не получен. Ничего на VPS не менялось."; exit 2; }
done

# ---------- 2. VPS: dc-switch и ключи ----------
say "== VPS: dc-switch и ограниченные ключи"
[[ -f deploy/ha/switch/dc-switch.sh ]] || { say "СТОП: нет deploy/ha/switch/dc-switch.sh"; exit 2; }
"${VM[@]}" "ssh -o BatchMode=yes '$TARGET' 'cat > /usr/local/bin/dc-switch.new && chmod 755 /usr/local/bin/dc-switch.new && mv -f /usr/local/bin/dc-switch.new /usr/local/bin/dc-switch'" < deploy/ha/switch/dc-switch.sh \
  || { say "СТОП: не удалось поставить dc-switch на VPS"; exit 1; }
on_vps <<EOF
set -e
f=/root/.ssh/authorized_keys; touch "\$f"; chmod 600 "\$f"
add() { grep -qF "\$1" "\$f" || printf '%s\n' "\$2" >> "\$f"; }
add '$K_VM_SWITCH'   'command="/usr/local/bin/dc-switch",restrict ssh-ed25519 $K_VM_SWITCH dc-switch-home'
add '$K_ERP_SWITCH'  'command="/usr/local/bin/dc-switch",restrict ssh-ed25519 $K_ERP_SWITCH dc-switch-office'
add '$K_ERP_HOP'     'command="/bin/false",restrict,port-forwarding,permitopen="127.0.0.1:4222" ssh-ed25519 $K_ERP_HOP dc-hop-office'
echo keys-ok
EOF

# ---------- 3. VPS: nginx ----------
say "== VPS: блок /db/ (с копией и откатом)"
out="$(on_vps <<EOF
set -u
DOMAIN='$DOMAIN'; SITE='$NGINX_SITE'; INC=/etc/nginx/datacore-upstream.conf
if [ -z "\$SITE" ]; then for c in /etc/nginx/sites-available/kppdf-proxy /etc/nginx/conf.d/kppdf-proxy.conf /etc/nginx/sites-enabled/kppdf-proxy; do [ -f "\$c" ] && { SITE=\$c; break; }; done; fi
[ -f "\$SITE" ] || { echo "STOP: файл kppdf-proxy не найден"; exit 2; }
[ -f "\$INC" ] || printf '# управляется dc-switch; руками не править\nupstream datacore_db { server 127.0.0.1:4201; }\n' > "\$INC"
if grep -q 'datacore-upstream.conf' "\$SITE" && grep -q 'proxy_pass http://datacore_db/' "\$SITE"; then echo "ALREADY"; exit 0; fi
n=\$(grep -c 'proxy_pass http://127.0.0.1:4201/;' "\$SITE")
[ "\$n" = 1 ] || { echo "STOP: ожидалась ровно одна строка proxy_pass на 4201, найдено \$n. Файл не менялся."; exit 3; }
BAK="\$SITE.bak-switch-\$(date +%Y%m%d%H%M)"; cp -p "\$SITE" "\$BAK"
sed -i 's#proxy_pass http://127.0.0.1:4201/;#proxy_pass http://datacore_db/;#' "\$SITE"
grep -q 'datacore-upstream.conf' "\$SITE" || sed -i '1i include /etc/nginx/datacore-upstream.conf;' "\$SITE"
back() { cp -p "\$BAK" "\$SITE"; nginx -t >/dev/null 2>&1 && systemctl reload nginx; }
nginx -t >/dev/null 2>&1 || { cp -p "\$BAK" "\$SITE"; echo "ROLLBACK: nginx -t не прошёл, файл возвращён"; exit 4; }
systemctl reload nginx || { back; echo "ROLLBACK: reload не удался"; exit 4; }
code=\$(curl -sk -m 10 --resolve "\$DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://\$DOMAIN/db/api/health/ready")
[ "\$code" = 200 ] || { back; echo "ROLLBACK: домен ответил \$code, файл возвращён"; exit 5; }
echo "DONE копия: \$BAK"
EOF
)"
rc=$?
say "$out"
if [[ $rc -ne 0 ]]; then say "СТОП: nginx не изменён или возвращён (код $rc). Остальные шаги не выполнялись."; exit 1; fi

# ---------- 4. ключи передачи VM↔Sportin ----------
say "== Ключи передачи данных (restrict)"
on_vm <<EOF
set -e
f=\$HOME/.ssh/authorized_keys; touch "\$f"; chmod 600 "\$f"
grep -qF '$K_ERP_TRANSFER' "\$f" || echo 'restrict,from="127.0.0.1" ssh-ed25519 $K_ERP_TRANSFER dc-transfer-office' >> "\$f"
EOF
on_erp <<EOF
set -e
f=\$HOME/.ssh/authorized_keys; touch "\$f"; chmod 600 "\$f"
grep -qF '$K_VM_TRANSFER' "\$f" || echo 'restrict ssh-ed25519 $K_VM_TRANSFER dc-transfer-home' >> "\$f"
EOF

# ---------- 5. bridge.env ----------
say "== bridge.env на серверах"
on_vm <<EOF
set -e
d=/var/lib/datacore/switch; mkdir -p "\$d"; chmod 1777 "\$d"
cat > "\$d/bridge.env" <<E2
HA_SELF=home
HA_PEER_SSH=$ERP_HOST
HA_PEER_KEY=\$HOME/.ssh/dc_transfer
HA_VPS_SSH=$TARGET
HA_VPS_KEY=\$HOME/.ssh/dc_switch
E2
chmod 600 "\$d/bridge.env"
EOF
on_erp <<EOF
set -e
d=/var/lib/datacore/switch; mkdir -p "\$d"; chmod 1777 "\$d"
cat > "\$d/bridge.env" <<E2
HA_SELF=office
HA_PEER_SSH=tiit@127.0.0.1
HA_PEER_PORT=4222
HA_PEER_KEY=\$HOME/.ssh/dc_transfer
HA_PEER_PROXY="ssh -i \$HOME/.ssh/dc_hop -o BatchMode=yes -o StrictHostKeyChecking=accept-new -W %h:%p $TARGET"
HA_VPS_SSH=$TARGET
HA_VPS_KEY=\$HOME/.ssh/dc_switch
E2
chmod 600 "\$d/bridge.env"
EOF

# ---------- 6. включение (по флагу) ----------
if [[ $ENABLE == 1 ]]; then
  say "== Включение: HA_SELF в .env и cron моста"
  for side in vm erp; do
    if [[ $side == vm ]]; then run=on_vm; self=home; else run=on_erp; self=office; fi
    $run <<EOF
set -e
[ -f /opt/data-core/deploy/ha/switch/switch-watch.sh ] || { echo "СТОП ($self): на сервере ещё нет deploy/ha/switch — сначала выкладка (VM) или refresh-copy.sh --code (Sportin). Ничего не включено."; exit 7; }
grep -q '^HA_SELF=' /opt/data-core/.env || echo 'HA_SELF=$self' >> /opt/data-core/.env
line='* * * * * DATA_DIR=/var/lib/datacore /bin/bash /opt/data-core/deploy/ha/switch/switch-watch.sh >/dev/null 2>&1'
(crontab -l 2>/dev/null | grep -v switch-watch.sh; echo "\$line") | crontab -
echo "$self: включено"
EOF
  done
  say "Кнопка заработает после перезапуска backend на каждом сервере (выкладка версии с кнопкой)."
fi

# ---------- 7. проверка ключей ----------
say "== Проверка"
"${VM[@]}" 'ssh -i $HOME/.ssh/dc_switch -o BatchMode=yes '"'$TARGET'"' status' 2>&1 | head -3 | sed 's/^/VM → dc-switch: /'
"${ERP[@]}" 'ssh -i $HOME/.ssh/dc_switch -o BatchMode=yes '"'$TARGET'"' status' 2>&1 | head -3 | sed 's/^/Sportin → dc-switch: /'
"${ERP[@]}" "ssh -i \$HOME/.ssh/dc_transfer -o BatchMode=yes -o StrictHostKeyChecking=accept-new -p 4222 -o ProxyCommand=\"ssh -i \$HOME/.ssh/dc_hop -o BatchMode=yes -W %h:%p $TARGET\" tiit@127.0.0.1 'echo Sportin→VM через VPS: ok'" 2>&1 | tail -1
"${VM[@]}" "ssh -i \$HOME/.ssh/dc_transfer -o BatchMode=yes -o StrictHostKeyChecking=accept-new $ERP_HOST 'echo VM→Sportin: ok'" 2>&1 | tail -1
say "Готово. Откат nginx: вернуть kppdf-proxy.bak-switch-<время> на VPS, nginx -t, reload. Отзыв ключей: удалить строки dc-switch-*/dc-hop-* в /root/.ssh/authorized_keys."
