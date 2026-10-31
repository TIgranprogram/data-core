#!/usr/bin/env bash
# Отправка свежего бэкапа в включённые цели kind:'smb' (коллекция backuptargets).
#   bash offsite-smb.sh          отправить последний бэкап во все включённые цели (cron после бэкапа)
#   bash offsite-smb.sh --poll   выполнить запросы из админки requestTest / requestRun (cron раз в минуту)
# Пароль только в файле доступа (-A), в командной строке и логе его нет.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/data-core}"
DATA_DIR="${DATA_DIR:-/var/lib/datacore}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
BACKUP_PATTERNS="${BACKUP_PATTERNS:-srv-erp-*.tgz datacore-*.tgz}"   # дом: datacore-*.tgz или папки mongo-* (backup.sh)
SMB_DIR="${OFFSITE_SMB_AUTH_DIR:-${SMB_DIR:-$DATA_DIR/smb}}"
SMB_IMAGE="${SMB_IMAGE:-datacore-smbclient}"
MONGO_CONTAINER="${MONGO_CONTAINER:-datacore-mongo}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-datacore-backend}"
OFFSITE_JS="${OFFSITE_JS:-/app/dist/src/modules/disk/offsite.js}"
[[ -f "$APP_DIR/.env" ]] && { set -a; . "$APP_DIR/.env"; set +a; }
MODE="send"; [[ "${1:-}" == "--poll" ]] && MODE="poll"

mkdir -p "$SMB_DIR"
exec 9>"$SMB_DIR/.lock"; flock -n 9 || exit 0   # один запуск за раз
TMPD="$(mktemp -d "$SMB_DIR/.tmp.XXXXXX")"; trap 'rm -rf "$TMPD"' EXIT

# Mongo: логин и пароль берутся из переменных контейнера, в командной строке их нет
mq() { docker exec "$MONGO_CONTAINER" sh -c 'mongo --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin datacore --eval "$0"' "$1"; }
# поля через табуляцию: id enabled requestTest requestRun url folder keep (url = //host/share)
targets() { mq "db.backuptargets.find({kind:'smb'}).forEach(function(t){print([t._id.str,t.enabled?1:0,t.requestTest?1:0,t.requestRun?1:0,t.url||'',t.folder||'srv-erp',t.keep||14].join('\t'))})"; }
report() { # id ok|error сообщение -> lastResult/lastError/lastAt, сбрасывает запросы
  local id="$1" res="$2" msg err="null"
  # без кавычек и обратных косых (строка идёт в mongo --eval); русский текст сохраняется
  msg="$(printf '%s' "$3" | tr -d "'" | tr -d '\\"`$' | tr '\n\r' '  ' | cut -c1-200)"
  [[ "$res" == error ]] && err="'$msg'"
  [[ "$id" =~ ^[0-9a-f]{24}$ ]] || return 0
  mq "db.backuptargets.updateOne({_id:ObjectId('$id')},{\$set:{lastResult:'$res',lastError:$err,lastAt:new Date(),requestTest:false,requestRun:false}})" >/dev/null
}
smb() { # каталог_данных(или "") команда  (AUTH, HOST, SHARE — переменные цели)
  local data="$1" cmd="$2"
  local vol=(-v "$AUTH:/auth:ro"); [[ -n "$data" ]] && vol+=(-v "$data:/data:ro")
  docker run --rm --network host "${vol[@]}" "$SMB_IMAGE" smbclient "//$HOST/$SHARE" -m SMB3 -A /auth -c "$cmd"
}
fail_msg() { # короткое понятное сообщение по тексту ошибки smbclient
  case "$1" in
    *LOGON_FAILURE*) echo "Неверный логин или пароль";;
    *BAD_NETWORK_NAME*) echo "Папка на сервере не найдена";;
    *ACCESS_DENIED*) echo "Нет прав на запись";;
    *UNREACHABLE*|*CONNECTION*|*timed*) echo "NAS не отвечает";;
    *DISK_FULL*) echo "На диске нет места";;
    *) echo "Сбой отправки";;
  esac
}
prep() { # разобрать поля цели в HOST, SHARE; ошибка -> 1
  [[ "$ID" =~ ^[0-9a-f]{24}$ ]] || return 1
  local u="${URLFIELD#//}"; HOST="${u%%/*}"; SHARE="${u#*/}"; SHARE="${SHARE%%/*}"
  AUTH="$SMB_DIR/auth.$ID"
  [[ "$HOST" =~ ^[A-Za-z0-9._-]+$ && "$SHARE" =~ ^[A-Za-z0-9._\ -]+$ &&"$FOLDER" =~ ^[A-Za-z0-9._-]+$ && -f "$AUTH" ]] \
    || { report "$ID" error "Цель настроена неверно или нет файла доступа"; return 1; }
  [[ "$KEEP" =~ ^[0-9]+$ && "$KEEP" -ge 1 ]] || KEEP=14
}

latest_file() { # печатает путь к файлу для отправки (.tgz или собранный из папок mongo-*)
  local f
  f="$(for p in $BACKUP_PATTERNS; do ls -1 "$BACKUP_DIR"/$p 2>/dev/null; done | xargs -r ls -1t 2>/dev/null | head -1 || true)"
  if [[ -n "$f" ]]; then echo "$f"; return; fi
  local m; m="$(ls -1dt "$BACKUP_DIR"/mongo-20* 2>/dev/null | head -1 || true)"; [[ -n "$m" ]] || return 1
  local s="${m##*/mongo-}" extra=()
  [[ -d "$BACKUP_DIR/uploads-$s" ]] && extra=("uploads-$s")
  tar -C "$BACKUP_DIR" -czf "$TMPD/datacore-$s.tgz" "mongo-$s" "${extra[@]}"
  echo "$TMPD/datacore-$s.tgz"
}
encrypt_if_needed() { # $1 файл -> печатает путь к отправляемому файлу (.dcb, если в настройках задан пароль шифрования)
  local sealed out
  sealed="$(mq "var s=db.backuptargets.findOne({_id:'settings'}); print(s&&s.password?s.password:'')" | tr -d '[:space:]')"
  if [[ -z "$sealed" ]]; then echo "$1"; return; fi
  out="$TMPD/$(basename "${1%.tgz}").dcb"
  SEALED="$sealed" docker exec -i -e SEALED -e OFFSITE_JS="$OFFSITE_JS" "$BACKEND_CONTAINER" node -e "
    const o=require(process.env.OFFSITE_JS);
    process.stdin.pipe(o.encryptStream(o.openSecret(process.env.SEALED))).pipe(process.stdout);" < "$1" > "$out"
  [[ -s "$out" ]] || return 1
  echo "$out"
}

do_test() { # пробный файл: создать папку, записать, удалить
  echo "test $(date)" > "$TMPD/.probe"
  smb "" "mkdir \"$FOLDER\"" >/dev/null 2>&1 || true
  smb "$TMPD" "cd \"$FOLDER\"; put /data/.probe .probe; del .probe"
}
do_send() { # $1 путь файла
  local src="$1" name pre list n
  name="$(basename "$src")"
  smb "" "mkdir \"$FOLDER\"" >/dev/null 2>&1 || true
  smb "$(dirname "$src")" "cd \"$FOLDER\"; put \"/data/$name\" \"$name\""
  # ротация: оставить KEEP последних по имени; префикс — всё до даты
  pre="$(echo "$name" | sed -E 's/[0-9]{8}-[0-9]{4}.*$//; s/[0-9]{4}-[0-9]{2}-[0-9]{2}.*$//')"
  list="$(smb "" "cd \"$FOLDER\"; ls ${pre}*" 2>/dev/null | awk '{print $1}' | grep -E "^${pre}.*\.(tgz|dcb)$" | sort || true)"
  n="$(printf '%s\n' "$list" | grep -c . || true)"
  if [[ "$n" -gt "$KEEP" ]]; then
    printf '%s\n' "$list" | head -n "$((n - KEEP))" | while read -r old; do smb "" "cd \"$FOLDER\"; del \"$old\"" >/dev/null 2>&1 || true; done
  fi
}

SENDFILE=""
run_send() {
  prep || return 0
  if [[ -z "$SENDFILE" ]]; then
    local f
    f="$(latest_file)" || { report "$ID" error "Нет свежего бэкапа"; return 0; }
    SENDFILE="$(encrypt_if_needed "$f")" || { report "$ID" error "Не удалось зашифровать"; return 0; }
  fi
  local o
  if o="$(do_send "$SENDFILE" 2>&1)"; then report "$ID" ok "Отправлено: $(basename "$SENDFILE")"; else report "$ID" error "$(fail_msg "$o")"; fi
}

while IFS=$'\t' read -r ID EN RT RR URLFIELD FOLDER KEEP; do
  [[ -n "$ID" ]] || continue
  if [[ "$MODE" == poll ]]; then
    if [[ "$RT" == 1 ]]; then
      prep || continue
      if o="$(do_test 2>&1)"; then report "$ID" ok "Проверка пройдена"; else report "$ID" error "$(fail_msg "$o")"; fi
    elif [[ "$RR" == 1 ]]; then run_send
    fi
  elif [[ "$EN" == 1 ]]; then run_send
  fi
done < <(targets)
