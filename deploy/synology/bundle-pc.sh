#!/bin/bash
# bundle-pc.sh — переносной пакет (БЗ-13), сторона ПК (Git Bash). Запуск: bundle.cmd или bash deploy/synology/bundle-pc.sh
#   1) собрать пакет на VM (bundle.sh) и скачать в C:\datacore-bundles\<дата>.tar.gz (докачка при обрыве, сверка sha256)
#   2) проверить пакет: sha256 архива + распаковка + сверка manifest.json
#   3) развернуть на новую VM — ТОЛЬКО печать шагов из MIGRATE.md (ничего не восстанавливается автоматически)
# Вход на VM — как в release.sh: VM (по умолч. tiit@192.168.1.52 или алиас datacore-vm с работы) и KEY (~/.ssh/kppdf80-vm).
# Пакет содержит СЕКРЕТЫ: папка локальная, не в репозитории, файлы 600. Не пересылать открыто.
# set -x не использовать.
set -uo pipefail
VM="${VM:-tiit@192.168.1.52}"
KEY="${KEY:-$HOME/.ssh/kppdf80-vm}"
LOCAL_DIR="${LOCAL_DIR:-/c/datacore-bundles}"
REMOTE_DIR="${REMOTE_DIR:-/opt/data-core}"
TRIES="${TRIES:-10}"
SSH=(ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
[[ -f "$KEY" ]] && SSH+=(-i "$KEY")
umask 077
mkdir -p "$LOCAL_DIR"; chmod 700 "$LOCAL_DIR" 2>/dev/null || true

die() { echo "ОШИБКА: $*" >&2; return 1; }

latest_local() { ls -1t "$LOCAL_DIR"/*.tar.gz 2>/dev/null | head -1; }

do_build_and_download() {
  echo "== Сборка пакета на VM (идёт несколько минут, фото и база копируются)"
  # BUNDLE_DIR не задаём — bundle.sh выберет сам; имя файла берём из последней строки «Готово: …»
  local log; log="$("${SSH[@]}" "$VM" "cd $REMOTE_DIR && bash deploy/synology/bundle.sh" 2>&1)" || { echo "$log" | tail -15; die "bundle.sh на VM завершился с ошибкой"; return 1; }
  echo "$log" | tail -8
  local remote; remote="$(echo "$log" | sed -n 's/^Готово: \(.*\.tar\.gz\) (.*/\1/p' | tail -1)"
  [[ -n "$remote" ]] || { die "не нашёл путь пакета в выводе VM"; return 1; }
  local rsha; rsha="$(echo "$log" | sed -n 's/^sha256: //p' | tail -1)"
  local stamp; stamp="$(date +%Y-%m-%d_%H%M%S)"
  local dest="$LOCAL_DIR/${stamp}.tar.gz"
  local part="${dest}.part"
  : > "$part"
  local size; size="$("${SSH[@]}" "$VM" "stat -c %s '$remote'")" || { die "не получил размер"; return 1; }
  echo "== Скачивание ($size байт) -> $dest"
  local n=0 have
  while :; do
    have="$(stat -c %s "$part" 2>/dev/null || echo 0)"
    [[ "$have" -ge "$size" ]] && break
    n=$((n+1)); [[ $n -gt $TRIES ]] && { die "не удалось скачать за $TRIES попыток (файл $part можно докачать повторным запуском вручную)"; return 1; }
    echo "  попытка $n, уже $have из $size"
    "${SSH[@]}" "$VM" "tail -c +$((have+1)) '$remote'" >> "$part" || sleep 5
  done
  mv "$part" "$dest"; chmod 600 "$dest" 2>/dev/null || true
  local lsha; lsha="$(sha256sum "$dest" | awk '{print $1}')"
  if [[ -n "$rsha" && "$lsha" == "$rsha" ]]; then echo "OK: sha256 совпал ($lsha)"
  else echo "ВНИМАНИЕ: sha256 не совпал (VM: ${rsha:-?}, ПК: $lsha) — удалите файл и повторите"; return 1; fi
  echo "Готово: $dest"
}

do_verify() {
  local f="${1:-$(latest_local)}"
  [[ -n "$f" && -f "$f" ]] || { die "нет пакета в $LOCAL_DIR"; return 1; }
  echo "== Проверка: $f"
  echo "  размер: $(stat -c %s "$f") байт"
  tar -tzf "$f" >/dev/null || { die "архив повреждён (tar -t)"; return 1; }
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  tar -xzf "$f" -C "$tmp" || { die "не распаковывается"; return 1; }
  local root; root="$(ls -1 "$tmp" | head -1)"; root="$tmp/$root"
  [[ -f "$root/manifest.json" ]] || { die "нет manifest.json"; return 1; }
  local bad=0 cnt=0 path want got
  while IFS= read -r line; do
    path="$(echo "$line" | sed -n 's/^ *"\(.*\)": "[0-9a-f]\{64\}",\{0,1\}$/\1/p')"
    want="$(echo "$line" | sed -n 's/^ *".*": "\([0-9a-f]\{64\}\)",\{0,1\}$/\1/p')"
    [[ -n "$path" && -n "$want" ]] || continue
    cnt=$((cnt+1))
    if [[ ! -f "$root/$path" ]]; then echo "  НЕТ файла: $path"; bad=$((bad+1)); continue; fi
    got="$(sha256sum "$root/$path" | awk '{print $1}')"
    [[ "$got" == "$want" ]] || { echo "  НЕ СОВПАЛ: $path"; bad=$((bad+1)); }
  done < "$root/manifest.json"
  echo "  файлов по manifest: $cnt, ошибок: $bad"
  echo "  коммиты/дата: $(grep -E '"(created|commits)"' "$root/manifest.json" | tr -s ' ' | tr '\n' ' ')"
  echo "  коллекций в manifest: $(grep -o '"[^"]*": *[0-9]\+' "$root/manifest.json" | wc -l) (список — в manifest.json)"
  [[ -s "$root/mongo/datacore.archive.gz" ]] || { echo "  ПУСТОЙ дамп Mongo"; bad=$((bad+1)); }
  [[ $cnt -gt 0 && $bad -eq 0 ]] && echo "ПАКЕТ В ПОРЯДКЕ" || { echo "ПАКЕТ С ОШИБКАМИ"; return 1; }
}

do_migrate_steps() {
  local f="${1:-$(latest_local)}"
  [[ -n "$f" && -f "$f" ]] || { die "нет пакета в $LOCAL_DIR"; return 1; }
  echo "== Шаги развёртывания из пакета (только печать, ничего не выполняется):"
  echo
  tar -xzOf "$f" --wildcards '*/MIGRATE.md' || die "в пакете нет MIGRATE.md"
}

menu() {
  echo "Переносной пакет data-core (хранилище: $LOCAL_DIR)"
  echo "  1) Собрать на VM и скачать"
  echo "  2) Проверить пакет (последний или путь)"
  echo "  3) Показать шаги переезда на новую VM (только печать)"
  echo "  0) Выход"
}
case "${1:-}" in
  build) do_build_and_download; exit $? ;;
  verify) do_verify "${2:-}"; exit $? ;;
  steps) do_migrate_steps "${2:-}"; exit $? ;;
esac
while :; do
  menu; read -r -p "Выбор: " c
  case "$c" in
    1) do_build_and_download ;;
    2) read -r -p "Путь к пакету (Enter — последний): " p; do_verify "$p" ;;
    3) read -r -p "Путь к пакету (Enter — последний): " p; do_migrate_steps "$p" ;;
    0|q) exit 0 ;;
    *) echo "?" ;;
  esac
  echo
done
