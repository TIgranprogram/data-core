#!/usr/bin/env bash
# C092: ключ ИИ для «Разобрать заявку» (КП). Ключ берётся из буфера обмена, в вывод не попадает.
#   bash deploy/synology/set-ai-key.sh local   - стенд на этом ПК (./.env)
#   bash deploy/synology/set-ai-key.sh prod    - сайт (/opt/data-core/.env на VM, копия .env рядом)
# Пишет строку ANTHROPIC_API_KEY=… в .env и пересоздаёт только контейнер backend (Mongo не трогает).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
WHERE="${1:-}"
[ "$WHERE" = local ] || [ "$WHERE" = prod ] || { echo "usage: set-ai-key.sh local|prod"; exit 2; }

# Через base64: кодировка консоли Windows не портит текст буфера.
KEY="$(powershell.exe -NoProfile -Command '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string](Get-Clipboard -Raw)))' 2>/dev/null | tr -d '\r\n' | base64 -d 2>/dev/null | tr -d '\r\n \t' || true)"
if ! [[ "$KEY" =~ ^sk-ant-[A-Za-z0-9_-]{20,}$ ]] || [ "${#KEY}" -gt 400 ]; then
  echo "✗ В буфере обмена нет ключа вида sk-ant-… Откройте console.anthropic.com → API Keys → создайте ключ, скопируйте и нажмите кнопку снова."
  exit 1
fi

# Обновить строку в .env: прочитать ключ из stdin, заменить или дописать.
UPDATE='f="$1"; IFS= read -r k; touch "$f"; cp "$f" "$f.bak-aikey"; grep -v "^ANTHROPIC_API_KEY=" "$f.bak-aikey" > "$f.tmp" || true; printf "ANTHROPIC_API_KEY=%s\n" "$k" >> "$f.tmp"; cat "$f.tmp" > "$f"; rm -f "$f.tmp"'

if [ "$WHERE" = local ]; then
  printf '%s\n' "$KEY" | bash -c "$UPDATE" _ ./.env
  docker compose up -d --no-deps backend >/dev/null
  echo "✓ Ключ сохранён на стенде этого ПК, сервер перезапущен. Кнопка «Разобрать заявку» появится в «Новом КП»."
else
  SSH=(ssh -i "$HOME/.ssh/datacore_work" -o BatchMode=yes datacore-vm)
  printf '%s\n' "$KEY" | "${SSH[@]}" "cd /opt/data-core && bash -c '$UPDATE' _ .env && docker compose up -d --no-deps backend >/dev/null && echo ok" | grep -q ok
  echo "✓ Ключ сохранён на сайте, сервер перезапущен (1–2 мин). Кнопка «Разобрать заявку» появится в «Новом КП»."
fi
