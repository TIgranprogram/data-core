#!/usr/bin/env bash
# C092: ключ ИИ для «Разобрать заявку» (КП). Ключ берётся из буфера обмена, в вывод не попадает.
#   bash deploy/synology/set-ai-key.sh local   - стенд на этом ПК (./.env)
#   bash deploy/synology/set-ai-key.sh prod    - сайт (/opt/data-core/.env на VM, копия .env рядом)
# Пишет строку ANTHROPIC_API_KEY=… в .env и пересоздаёт только контейнер backend (Mongo не трогает).
set +x
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
WHERE="${1:-}"
[ "$WHERE" = local ] || [ "$WHERE" = prod ] || { echo "usage: set-ai-key.sh local|prod"; exit 2; }

if [ "${2:-}" = --stdin ]; then
  IFS= read -r KEY || { echo "✗ Не удалось прочитать ключ из поля ввода."; exit 1; }
  if ! [[ "$KEY" =~ ^sk-ant-[A-Za-z0-9_-]{20,}$ ]] || [ "${#KEY}" -gt 400 ]; then
    echo "✗ Вставьте секретный ключ Anthropic вида sk-ant-…."
    exit 1
  fi
else
  # Через base64: кодировка консоли Windows не портит текст буфера.
  KEY="$(powershell.exe -NoProfile -Command '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string](Get-Clipboard -Raw)))' 2>/dev/null | tr -d '\r\n' | base64 -d 2>/dev/null | tr -d '\r\n \t' || true)"
fi
if ! [[ "$KEY" =~ ^sk-ant-[A-Za-z0-9_-]{20,}$ ]] || [ "${#KEY}" -gt 400 ]; then
  case "$KEY" in
    kppd_*) echo "✗ В буфере машинный ключ data-core (kppd_, ${#KEY} знаков). Для КП нужен ключ Anthropic (sk-ant-…)." ;;
    apikey_*) echo "✗ В буфере идентификатор ключа Anthropic (apikey_, ${#KEY} знаков). Для КП нужно секретное значение ключа (sk-ant-…)." ;;
    "") echo "✗ Буфер пуст или его не удалось прочитать." ;;
    *) echo "✗ В буфере ${#KEY} знаков. Ожидается ключ Anthropic вида sk-ant-…." ;;
  esac
  echo "В консоли Anthropic откройте API Keys. Если секретное значение уже не видно, создайте новый ключ, скопируйте его из окна создания и снова нажмите кнопку пульта."
  exit 1
fi

# Обновить строку в .env: прочитать ключ из stdin, заменить или дописать.
UPDATE='set -eu
umask 077
f="$1"
IFS= read -r k
touch "$f"
tmp="$(mktemp "$f.aikey.XXXXXX")"
cleanup() { rm -f -- "$tmp"; }
trap cleanup EXIT
cat "$f" > "$tmp"
mv -f -- "$tmp" "$f.bak-aikey"
tmp="$(mktemp "$f.aikey.XXXXXX")"
grep -v "^ANTHROPIC_API_KEY=" "$f.bak-aikey" > "$tmp" || [ "$?" -eq 1 ]
printf "ANTHROPIC_API_KEY=%s\n" "$k" >> "$tmp"
cat "$tmp" > "$f"'

if [ "$WHERE" = local ]; then
  printf '%s\n' "$KEY" | bash -c "$UPDATE" _ ./.env
  docker compose up -d --no-deps backend >/dev/null
  echo "✓ Ключ сохранён на стенде этого ПК, сервер перезапущен. Кнопка «Разобрать заявку» появится в «Новом КП»."
else
  SSH=(ssh -i "$HOME/.ssh/datacore_work" -o BatchMode=yes datacore-vm)
  printf '%s\n' "$KEY" | "${SSH[@]}" "cd /opt/data-core && bash -c '$UPDATE' _ .env && docker compose up -d --no-deps backend >/dev/null && echo ok" | grep -q ok
  echo "✓ Ключ сохранён на сайте, сервер перезапущен (1–2 мин). Кнопка «Разобрать заявку» появится в «Новом КП»."
fi
