#!/bin/bash
# bundle.sh — переносной пакет (БЗ-13): всё приложение в одном архиве.
# Запуск НА VM:  cd /opt/data-core && bash deploy/synology/bundle.sh
#
# Что кладёт в архив (datacore-bundle-<дата>.tar.gz):
#   code/data-core.tar.gz, code/kppdf.tar.gz   код (git archive, если есть .git; иначе tar без node_modules/данных)
#   mongo/datacore.archive.gz                  mongodump --archive --gzip всей БД datacore (Mongo 4.4)
#   uploads/data-core-uploads.tar.gz, uploads/kppdf-uploads*.tar.gz
#   config/                                    compose, .env обоих проектов, nginx, crontab, systemd
#   MIGRATE.md                                 как развернуть (для агента)
#   manifest.json                              дата, коммиты, число документов по коллекциям, sha256 файлов
#
# ВНИМАНИЕ: в пакете СЕКРЕТЫ (.env, пароли Mongo, ключи). Архив создаётся с правами 600.
# Не класть в репозиторий, не слать в чат/почту, хранить как пароль.
#
# Переменные (необязательные):
#   BUNDLE_DIR       куда положить архив (по умолч. общая папка Synology, если смонтирована, иначе /opt/datacore-bundles)
#   DC_DIR           каталог data-core            (/opt/data-core)
#   KPPDF_DIR        каталог kppdf                (/opt/kppdf-8.0)
#   DATA_DIR         данные data-core             (/var/lib/datacore)
#   KPPDF_UPLOADS    папки фото kppdf через пробел (по умолч. ищутся /var/lib/kppdf*/uploads и $KPPDF_DIR/uploads)
#   MONGO_CONTAINER  datacore-mongo,  MONGO_DB datacore
#   BUNDLE_KEEP      сколько последних пакетов хранить (по умолч. 3; 0 — не удалять старые)
#
# Правила: скрипт ничего не останавливает и не перезапускает, в базу только читает.
# set -x НЕ использовать: скрипт читает .env, трассировка напечатала бы секреты.
set -euo pipefail
umask 077

DC_DIR="${DC_DIR:-/opt/data-core}"
KPPDF_DIR="${KPPDF_DIR:-/opt/kppdf-8.0}"
DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
MONGO_CONTAINER="${MONGO_CONTAINER:-datacore-mongo}"
MONGO_DB="${MONGO_DB:-datacore}"
DOCKER="${DOCKER_CMD:-docker}"
KEEP="${BUNDLE_KEEP:-3}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- пароль root Mongo из .env (в вывод не попадает) ---
ENV_FILE="${SCRIPT_DIR}/.env"
[[ -f "$ENV_FILE" ]] || ENV_FILE="${DC_DIR}/.env"
[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }
MONGO_ROOT_USER="${MONGO_ROOT_USER:-root}"
if [[ -z "${MONGO_ROOT_PASSWORD:-}" ]]; then
  echo "ERROR: MONGO_ROOT_PASSWORD не задан (deploy/synology/.env или ${DC_DIR}/.env)" >&2
  exit 1
fi

# --- куда класть ---
if [[ -z "${BUNDLE_DIR:-}" ]]; then
  for c in /mnt/synology-share /mnt/nas /mnt/share /volume1/datacore-bundles; do
    if [[ -d "$c" && -w "$c" ]] && mountpoint -q "$c" 2>/dev/null; then BUNDLE_DIR="$c/datacore-bundles"; break; fi
    if [[ "$c" == /volume1/* && -d "$c" && -w "$c" ]]; then BUNDLE_DIR="$c"; break; fi
  done
  BUNDLE_DIR="${BUNDLE_DIR:-/opt/datacore-bundles}"
fi
mkdir -p "$BUNDLE_DIR" 2>/dev/null || sudo -n mkdir -p "$BUNDLE_DIR" || { echo "ERROR: нельзя создать $BUNDLE_DIR (задайте BUNDLE_DIR)" >&2; exit 1; }
[[ -w "$BUNDLE_DIR" ]] || { echo "ERROR: нет записи в $BUNDLE_DIR (задайте BUNDLE_DIR или sudo chown)" >&2; exit 1; }
chmod 700 "$BUNDLE_DIR" 2>/dev/null || true

# --- место: нужно примерно размер данных + код ---
need_kb=$(du -sk "${DATA_DIR}/uploads" 2>/dev/null | awk '{print $1}')
need_kb=$(( ${need_kb:-0} + 1048576 ))
free_kb=$(df -Pk "$BUNDLE_DIR" | tail -1 | awk '{print $4}')
if [[ "$free_kb" -lt "$need_kb" ]]; then
  echo "СТОП: в $BUNDLE_DIR свободно ${free_kb} КБ, нужно не меньше ~${need_kb} КБ" >&2
  exit 1
fi

DATE="$(date +%Y-%m-%d_%H%M%S)"
NAME="datacore-bundle-${DATE}"
STAGE="$(mktemp -d "${BUNDLE_DIR}/.stage-${DATE}.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$NAME"/{code,mongo,uploads,config}
W="$STAGE/$NAME"

echo "=== Переносной пакет ($(date)) ==="
echo "    в: ${BUNDLE_DIR}/${NAME}.tar.gz"

# --- 1. код ---
pack_code() { # $1 каталог, $2 выходной файл, $3 имя для manifest
  local dir="$1" out="$2" commit="нет git"
  if [[ ! -d "$dir" ]]; then echo "  [пропуск] нет каталога $dir" >&2; echo "нет каталога" > "$out.missing"; echo "$commit"; return 0; fi
  if [[ -d "$dir/.git" ]] && git -C "$dir" rev-parse HEAD >/dev/null 2>&1; then
    git -C "$dir" archive --format=tar.gz -o "$out" HEAD
    commit="$(git -C "$dir" rev-parse --short HEAD)"
    git -C "$dir" status --porcelain 2>/dev/null | head -1 | grep -q . && commit="$commit+незакоммиченное"
  else
    # на VM код лежит без .git (его кладёт deploy.py/release.sh) — берём рабочие файлы
    tar -czf "$out" -C "$(dirname "$dir")" \
      --exclude='node_modules' --exclude='.git' --exclude='.data' --exclude='dist' \
      --exclude='uploads' --exclude='*.bak*' --exclude='backend.prev-*' \
      --exclude='.env' --exclude='.kppdf-mongo-pw' --exclude='config.env' --exclude='CREDENTIALS.md' \
      "$(basename "$dir")"
    [[ -f "$dir/REVISION" ]] && commit="$(head -c 40 "$dir/REVISION")"
  fi
  echo "$commit"
}
echo "--- код"
DC_COMMIT="$(pack_code "$DC_DIR" "$W/code/data-core.tar.gz")"
KP_COMMIT="$(pack_code "$KPPDF_DIR" "$W/code/kppdf.tar.gz")"
echo "    data-core: ${DC_COMMIT}; kppdf: ${KP_COMMIT}"

# --- 2. счётчики документов (до дампа) ---
echo "--- счётчики коллекций"
COUNTS_JS='var o=[];db.getCollectionNames().forEach(function(n){o.push(JSON.stringify(n)+":"+db.getCollection(n).countDocuments({}))});print("{"+o.join(",")+"}")'
COUNTS_JSON="$($DOCKER exec -e MP="$MONGO_ROOT_PASSWORD" "$MONGO_CONTAINER" sh -c \
  "mongo --quiet -u '$MONGO_ROOT_USER' -p \"\$MP\" --authenticationDatabase admin '$MONGO_DB' --eval '$COUNTS_JS'" 2>/dev/null | tail -1)" || COUNTS_JSON="{}"
[[ "$COUNTS_JSON" == "{"* ]] || COUNTS_JSON="{}"

# --- 3. mongodump (пароль — через переменную окружения контейнера, не в списке процессов хоста) ---
echo "--- mongodump ${MONGO_DB}"
$DOCKER exec -e MP="$MONGO_ROOT_PASSWORD" "$MONGO_CONTAINER" sh -c \
  "mongodump --username '$MONGO_ROOT_USER' --password \"\$MP\" --authenticationDatabase admin --db '$MONGO_DB' --archive --gzip" \
  > "$W/mongo/datacore.archive.gz"
[[ -s "$W/mongo/datacore.archive.gz" ]] || { echo "ERROR: дамп пустой" >&2; exit 1; }

# --- 4. uploads ---
echo "--- uploads"
if [[ -d "${DATA_DIR}/uploads" ]]; then
  tar -czf "$W/uploads/data-core-uploads.tar.gz" -C "${DATA_DIR}" uploads
else
  echo "    нет ${DATA_DIR}/uploads"
fi
KP_UP="${KPPDF_UPLOADS:-}"
if [[ -z "$KP_UP" ]]; then
  for d in /var/lib/kppdf*/uploads "${KPPDF_DIR}/uploads"; do [[ -d "$d" ]] && KP_UP="$KP_UP $d"; done
fi
i=0
for d in $KP_UP; do
  i=$((i+1))
  tar -czf "$W/uploads/kppdf-uploads-${i}.tar.gz" -C "$(dirname "$d")" "$(basename "$d")"
  echo "$d" >> "$W/uploads/kppdf-uploads-sources.txt"
  echo "    kppdf: $d"
done

# --- 5. конфиги (с секретами!). Нет файла или доступа — пропускаем, не падаем ---
echo "--- конфиги"
CF="$W/config"
cp_try() { # $1 источник, $2 имя в config/
  local src="$1" dst="$CF/$2"
  mkdir -p "$(dirname "$dst")"
  if [[ -r "$src" ]]; then cp -a "$src" "$dst"
  elif sudo -n test -r "$src" 2>/dev/null; then sudo -n cat "$src" > "$dst"
  else echo "    [нет] $src" ; return 0; fi
}
for f in docker-compose.yml docker-compose.prod.yml .env; do cp_try "$DC_DIR/$f" "data-core/$f"; done
cp_try "$DC_DIR/deploy/synology/.env" "data-core/deploy-synology.env"
for f in docker-compose.yml docker-compose.prod.yml .env .kppdf-mongo-pw; do cp_try "$KPPDF_DIR/$f" "kppdf/$f"; done
# nginx: основной работает на VPS, не на VM. Если тут есть копия — берём; блок /db/ в любом случае лежит в коде.
cp_try /etc/nginx/sites-available/kppdf-proxy "nginx/kppdf-proxy"
cp_try "$DC_DIR/deploy/synology/nginx-datacore-db.conf" "nginx/nginx-datacore-db.conf"
# crontab (туннели, бэкапы) и systemd
crontab -l > "$CF/crontab-$(id -un).txt" 2>/dev/null || echo "    [нет] crontab пользователя"
cp_try /etc/cron.d/datacore "cron.d/datacore"
cp_try /etc/systemd/system/kppdf-tunnel.service "systemd/kppdf-tunnel.service"
for u in /etc/systemd/system/kppdf-*.service; do [[ -e "$u" ]] && cp_try "$u" "systemd/$(basename "$u")"; done
cp_try "$DC_DIR/deploy/synology/datacore-tunnel.sh" "data-core/datacore-tunnel.sh"
find "$CF" -type f -exec chmod 600 {} + 2>/dev/null || true

# --- 6. MIGRATE.md ---
cat > "$W/MIGRATE.md" <<'MIG'
# Как развернуть этот пакет на новой VM (инструкция для агента)

Пакет содержит СЕКРЕТЫ (`config/**/.env`, пароли Mongo, ключи). Не коммитить, не выводить в чат.
Целевая система: Ubuntu + Docker + docker compose. CPU без AVX -> Mongo остаётся 4.4 (`mongo:4.4`).
Всё, что ниже, выполняется ПОСЛЕ «да» пользователя. На живую базу ничего не восстанавливать без явного «да».

1. Проверить пакет: `sha256sum -c` по `manifest.json` (поле `files`) — скрипт `bundle-pc.sh` (пункт 2) делает это сам.
2. Подготовить каталоги: `/opt/data-core`, `/opt/kppdf-8.0`, `/var/lib/datacore/{mongodb,uploads,backups}`.
3. Код: `tar -xzf code/data-core.tar.gz -C /opt/` (папка внутри — `data-core` или корень архива; смотреть `tar -tzf | head`), то же `code/kppdf.tar.gz` в `/opt/`.
4. Конфиги: `config/data-core/.env` -> `/opt/data-core/.env`, `config/data-core/deploy-synology.env` -> `/opt/data-core/deploy/synology/.env` (если был), `config/kppdf/.env` -> `/opt/kppdf-8.0/.env`, `config/kppdf/.kppdf-mongo-pw` -> `/opt/kppdf-8.0/.kppdf-mongo-pw` (права 600). Права на все `.env` — 600.
5. Фото: `tar -xzf uploads/data-core-uploads.tar.gz -C /var/lib/datacore/`; `uploads/kppdf-uploads-sources.txt` — откуда какой архив `kppdf-uploads-N.tar.gz`, распаковать в родительскую папку источника.
6. Поднять ТОЛЬКО Mongo: `cd /opt/data-core && docker compose -f docker-compose.prod.yml up -d mongo` (с первым запуском пройдут инит rs0 и пользователи — как делает `deploy.py`; при сомнении запустить обычный `deploy.py` без `--wipe`). Порядок: сначала контур data-core, потом kppdf.
7. Данные в ПУСТУЮ базу (новая VM):
   `docker exec -i datacore-mongo sh -c 'mongorestore --username root --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --gzip --archive' < mongo/datacore.archive.gz`
   (пароль передать через `-e MONGO_ROOT_PASSWORD=...`). Без `--drop`. Если база не пуста — остановиться и спросить пользователя.
8. Сверка: число документов по коллекциям из `manifest.json` (`collections`) против `db.<имя>.countDocuments({})`.
9. Поднять backend data-core, затем kppdf (`/opt/kppdf-8.0`, сеть `data-core_default`).
10. Публичный доступ (`https://kppdf-crm.ru/db/`): nginx живёт на VPS. Блок для `/db/` — `config/nginx/nginx-datacore-db.conf`; `config/nginx/kppdf-proxy` есть, только если файл читался с VM. Туннели: `config/crontab-*.txt` (строки `datacore-tunnel`, `datacore-ssh-tunnel`), `config/systemd/kppdf-tunnel.service`. Адрес VPS, ключи и порты 4200/4201/4222 переносить осознанно; на VPS при смене VM поменять только вход туннеля.
11. Cron бэкапов: `config/cron.d/datacore` или строка из crontab (`backup.sh` ежедневно в 03:00).
12. Проверка: `curl -s http://127.0.0.1:3001/api/health`, вход в админку, открыть заказ с фото.

Чего в пакете НЕТ: образов Docker (собираются из кода), `node_modules`, старых бэкапов, ключей SSH рабочего ПК (`remote-access/secret/`).
MIG

# --- 7. manifest.json ---
echo "--- manifest"
{
  printf '{\n'
  printf '  "created": "%s",\n' "$(date -Iseconds)"
  printf '  "host": "%s",\n' "$(hostname)"
  printf '  "commits": {"data-core": "%s", "kppdf": "%s"},\n' "$DC_COMMIT" "$KP_COMMIT"
  printf '  "mongo": {"db": "%s", "dump": "mongo/datacore.archive.gz"},\n' "$MONGO_DB"
  printf '  "collections": %s,\n' "$COUNTS_JSON"
  printf '  "files": {\n'
  first=1
  while IFS= read -r f; do
    [[ "$f" == "manifest.json" ]] && continue
    h="$(sha256sum "$W/$f" | awk '{print $1}')"
    [[ $first -eq 1 ]] && first=0 || printf ',\n'
    printf '    "%s": "%s"' "$f" "$h"
  done < <(cd "$W" && find . -type f ! -name manifest.json | sed 's|^\./||' | sort)
  printf '\n  }\n}\n'
} > "$W/manifest.json"

# --- 8. архив (600) + sha256 ---
OUT="${BUNDLE_DIR}/${NAME}.tar.gz"
tar -czf "$OUT" -C "$STAGE" "$NAME"
chmod 600 "$OUT"
( cd "$BUNDLE_DIR" && sha256sum "${NAME}.tar.gz" > "${NAME}.tar.gz.sha256" && chmod 600 "${NAME}.tar.gz.sha256" )

# ротация: оставить последние KEEP пакетов
if [[ "$KEEP" -gt 0 ]]; then
  ls -1t "$BUNDLE_DIR"/datacore-bundle-*.tar.gz 2>/dev/null | tail -n +$((KEEP+1)) | while IFS= read -r old; do
    echo "  удаляю старый пакет: $(basename "$old")"
    rm -f "$old" "$old.sha256"
  done
fi

echo "Готово: $OUT ($(du -h "$OUT" | awk '{print $1}'), права $(stat -c %a "$OUT"))"
echo "sha256: $(awk '{print $1}' "${OUT}.sha256")"
echo "Пакет содержит секреты: не класть в репозиторий и не пересылать открыто."
