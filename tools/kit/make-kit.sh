#!/usr/bin/env bash
# Страховочный чемоданчик: всё, чего нет в GitHub, в зашифрованный архив. Запускает пользователь, из корня репо:
#   bash tools/kit/make-kit.sh
#   --open — обычный zip без пароля: кто получит файл, получит все доступы.
# Без флага 7-Zip спросит пароль. Содержимое файлов на экран не выводится. Рабочая папка стирается в конце.
set -euo pipefail
Z="/c/Program Files/7-Zip/7z.exe"
[[ -x "$Z" ]] || { echo "СТОП: нет 7-Zip"; exit 2; }
cd "$(git rev-parse --show-toplevel)"
OUT=/d/datacore-kit; mkdir -p "$OUT"
NAME="datacore-kit-$(date +%Y-%m-%d).7z"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/ssh" "$W/project" "$W/claude-memory"

cp -a "$HOME/.ssh/." "$W/ssh/"
for f in .env deploy/synology/config.env deploy/synology/CREDENTIALS.md deploy/synology/access.env \
         SRV-ERP/connect.txt SRV-ERP/access-package/password.txt .claude/settings.local.json; do
  [[ -f "$f" ]] && { mkdir -p "$W/project/$(dirname "$f")"; cp -a "$f" "$W/project/$f"; }
done
for d in remote-access/secret secrets; do
  [[ -d "$d" ]] && { mkdir -p "$W/project/$d"; cp -a "$d/." "$W/project/$d/"; }
done
M="$HOME/.claude/projects/D--data-core/memory"; [[ -d "$M" ]] && cp -a "$M/." "$W/claude-memory/"
cp tools/kit/README-чемоданчик.md "$W/"

if [[ "${1:-}" == "--open" ]]; then
  NAME="${NAME%.7z}.zip"; rm -f "$OUT/$NAME"
  ( cd "$W" && "$Z" a -tzip -bso0 -bsp0 "$(cygpath -w "$OUT/$NAME")" . )
  "$Z" t -bso0 -bsp0 "$(cygpath -w "$OUT/$NAME")" || { echo "СТОП: архив не проверился"; exit 1; }
  echo "Готово: D:\datacore-kit\$NAME ($(du -h "$OUT/$NAME" | cut -f1)). Файлов: $(find "$W" -type f | wc -l). Архив без пароля: храните как ключи."
  exit 0
fi
echo "Придумайте пароль архива: не короче 16 знаков. Без него архив не открыть."
rm -f "$OUT/$NAME"
( cd "$W" && "$Z" a -t7z -mhe=on -p -bso0 -bsp0 "$(cygpath -w "$OUT/$NAME")" . )
echo "Проверка: введите тот же пароль ещё раз."
"$Z" t -p -bso0 -bsp0 "$(cygpath -w "$OUT/$NAME")" || { echo "СТОП: архив не проверился. Запустите скрипт снова."; exit 1; }
echo "Готово: D:\\datacore-kit\\$NAME ($(du -h "$OUT/$NAME" | cut -f1)). Файлов: $(find "$W" -type f | wc -l)."
