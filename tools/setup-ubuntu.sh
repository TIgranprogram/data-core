#!/usr/bin/env bash
# DataCore: первый запуск на Ubuntu (ноутбук владельца, 2026-11-15).
#   bash tools/setup-ubuntu.sh          — проверить и доустановить всё недостающее (спросит пароль sudo)
#   bash tools/setup-ubuntu.sh --check  — только проверить, ничего не ставить
# Повторный запуск безопасен: что уже стоит — пропускается.
# Секреты (.env, deploy/synology/config.env, access.env, ключи SSH) скрипт НЕ создаёт и не читает —
# в конце покажет, какие файлы перенести со старого компьютера.
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
FAIL=0
ok()   { printf '  \033[32m[ok]\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m[!!]\033[0m %s\n' "$1"; FAIL=1; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
inst() { [ $CHECK = 1 ] && { bad "$1 — нет (запустите без --check, чтобы поставить)"; return 1; }; echo "  … ставлю $1"; return 0; }

[ "$(uname -s)" = "Linux" ] || { echo "Скрипт для Ubuntu/Linux."; exit 2; }
. /etc/os-release 2>/dev/null; echo "Система: ${PRETTY_NAME:-Linux} · папка: $ROOT"

step "1. Базовые программы (git, curl, сборка)"
NEED=""
for p in git curl ca-certificates gnupg build-essential python3 jq unzip openssh-client; do
  dpkg -s "$p" >/dev/null 2>&1 || NEED="$NEED $p"
done
if [ -z "$NEED" ]; then ok "всё на месте"; elif inst "$NEED"; then sudo apt-get update -qq && sudo apt-get install -y -qq $NEED && ok "поставлено:$NEED"; fi

step "2. Node.js 20+ и pnpm 9"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 20 ]; then ok "Node $(node -v)"
elif inst "Node.js 22 LTS"; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null && sudo apt-get install -y -qq nodejs && ok "Node $(node -v)"
fi
if have pnpm && pnpm -v 2>/dev/null | grep -q '^9\.'; then ok "pnpm $(pnpm -v)"
elif have node && inst "pnpm 9 (corepack)"; then
  sudo corepack enable && corepack prepare pnpm@9.15.0 --activate >/dev/null && ok "pnpm $(pnpm -v)"
fi

step "3. Docker (стенд и e2e: Mongo 4.4)"
if have docker && docker compose version >/dev/null 2>&1; then ok "Docker $(docker -v | cut -d' ' -f3 | tr -d ,) + compose"
elif inst "Docker Engine + compose"; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME:-noble} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && ok "Docker поставлен"
fi
if have docker; then
  if id -nG "$USER" | grep -qw docker; then ok "вы в группе docker"
  elif [ $CHECK = 1 ]; then bad "вы не в группе docker"
  else sudo usermod -aG docker "$USER" && echo "  … добавил в группу docker — ВЫЙДИТЕ ИЗ СИСТЕМЫ И ВОЙДИТЕ СНОВА (или перезагрузка)"; fi
  docker info >/dev/null 2>&1 && ok "Docker работает" || echo "  (Docker заработает без sudo после повторного входа)"
fi

step "4. Браузер для обходов сайта (Chrome)"
BROWSER=""
for b in /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium; do [ -x "$b" ] && { BROWSER="$b"; break; }; done
if [ -n "$BROWSER" ]; then ok "браузер: $BROWSER"
elif inst "Google Chrome"; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq google-chrome-stable && BROWSER=/usr/bin/google-chrome && ok "Chrome поставлен"
fi

step "5. Настройки окружения (~/.bashrc)"
BK="$HOME/datacore-backups"
if grep -q '# DataCore' "$HOME/.bashrc" 2>/dev/null; then ok "уже записаны"
elif [ $CHECK = 1 ]; then bad "нет блока # DataCore в ~/.bashrc"
else
  { echo ''; echo '# DataCore (tools/setup-ubuntu.sh)';
    [ -n "$BROWSER" ] && { echo "export EDGE=$BROWSER"; echo "export DESIGN_BROWSER=$BROWSER"; }
    echo "export DC_BACKUPS=$BK";
    echo "alias dc='node $ROOT/tools/dc.mjs'"; } >> "$HOME/.bashrc"
  ok "записал EDGE, DESIGN_BROWSER, DC_BACKUPS и команду dc (новый терминал или: source ~/.bashrc)"
fi
[ -d "$BK" ] || { [ $CHECK = 1 ] && bad "нет папки копий $BK" || { mkdir -p "$BK" && ok "папка копий $BK"; }; }

step "6. Git и проект"
[ "$(git config core.hooksPath)" = ".githooks" ] && ok "хуки коммита включены" || { [ $CHECK = 1 ] && bad "хуки коммита не включены" || { git config core.hooksPath .githooks && ok "хуки коммита включены"; }; }
[ "$(git config core.autocrlf)" = "input" ] && ok "переводы строк: LF" || { [ $CHECK = 1 ] && bad "core.autocrlf не input" || { git config core.autocrlf input && ok "переводы строк: LF"; }; }
chmod +x .githooks/* deploy/synology/*.sh tools/*.sh 2>/dev/null
git config user.name >/dev/null && git config user.email >/dev/null && ok "автор коммитов: $(git config user.name)" || bad "не задан автор коммитов: git config --global user.name / user.email"
if [ -d backend/node_modules ]; then ok "зависимости backend стоят"
elif have pnpm && inst "зависимости backend (pnpm install)"; then (cd backend && pnpm install --frozen-lockfile >/dev/null) && ok "зависимости backend поставлены"; fi

step "7. Файлы, которых нет в GitHub (перенести со старого компьютера)"
for f in .env deploy/synology/config.env deploy/synology/access.env; do
  [ -f "$f" ] && ok "$f" || bad "$f — скопируйте со старого ПК (пример: ${f}.example, если есть)"
done
ls "$HOME"/.ssh/id_* >/dev/null 2>&1 && ok "ключ SSH есть (выкладка на сервер)" || bad "нет ключа SSH в ~/.ssh — перенесите со старого ПК (нужен для выкладки)"

step "8. Итоговая проверка проекта"
if [ $FAIL = 0 ] && have node && [ -d backend/node_modules ]; then node tools/dc.mjs check || FAIL=1
else echo "  (пропущено: сначала исправьте пункты [!!])"; fi

echo
if [ $FAIL = 0 ]; then echo "ГОТОВО: всё стоит. Новый терминал → dc start"; else echo "ЕСТЬ ПУНКТЫ [!!] — исправьте и запустите снова: bash tools/setup-ubuntu.sh"; fi
exit $FAIL
