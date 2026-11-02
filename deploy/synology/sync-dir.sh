#!/usr/bin/env bash
# Обновить папку на месте без rsync (на VM его нет): sync-dir.sh <откуда> <куда> [--skip <имя файла в корне>]
# Сама папка <куда> не переносится и не удаляется (её держит привязка контейнера): лишние файлы удаляются,
# новые и изменённые — копируются. --skip — файл в корне не трогать (version.json кладётся последним отдельно).
set -euo pipefail
SRC="${1:?откуда}"; DST="${2:?куда}"; SKIP="${4:-}"
[[ "${3:-}" == "--skip" ]] || SKIP=""
[[ -d "$SRC" && -d "$DST" ]] || { echo "sync-dir: нет папки $SRC или $DST"; exit 1; }
list() { (cd "$1" && find . -type f | sort); }
NEW="$(mktemp)"; OLD="$(mktemp)"; trap 'rm -f "$NEW" "$OLD"' EXIT
list "$SRC" > "$NEW"; list "$DST" > "$OLD"
# лишние: есть в <куда>, нет в <откуда> (кроме --skip)
comm -13 "$NEW" "$OLD" | while IFS= read -r f; do [[ -n "$SKIP" && "$f" == "./$SKIP" ]] && continue; rm -f "$DST/$f"; done
# новые и изменённые (одинаковые по содержимому не трогаем)
while IFS= read -r f; do
  [[ -n "$SKIP" && "$f" == "./$SKIP" ]] && continue
  if ! cmp -s "$SRC/$f" "$DST/$f" 2>/dev/null; then mkdir -p "$(dirname "$DST/$f")"; cp -p "$SRC/$f" "$DST/$f.sync-tmp" && mv -f "$DST/$f.sync-tmp" "$DST/$f"; fi
done < "$NEW"
find "$DST" -mindepth 1 -type d -empty -delete
