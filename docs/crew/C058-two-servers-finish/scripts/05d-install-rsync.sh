#!/usr/bin/env bash
# Нужен для refresh/switch (фото/код). Без удаления данных.
set -euo pipefail

install_side() {
  local name="$1"; shift
  echo "== rsync на $name"
  "$@" 'bash -s' <<'EOF'
set -euo pipefail
if command -v rsync >/dev/null 2>&1; then
  rsync --version | head -1
  echo RSYNC_ALREADY
  exit 0
fi
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  sudo -n apt-get update -qq
  sudo -n apt-get install -y -qq rsync
elif command -v apt-get >/dev/null 2>&1 && [[ $(id -u) -eq 0 ]]; then
  apt-get update -qq && apt-get install -y -qq rsync
else
  # через privileged docker с mount хоста /usr/bin — хрупко; пробуем nix/static
  echo "пробуем static rsync в \$HOME/bin"
  mkdir -p "$HOME/bin"
  # пакет из apt без sudo недоступен — стоп с явной причиной
  echo "СТОП: нет rsync и нет passwordless sudo для apt"
  id; groups
  exit 7
fi
command -v rsync
rsync --version | head -1
echo RSYNC_OK
EOF
}

install_side home ssh -o BatchMode=yes datacore-vm
install_side office ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro
echo ALL_RSYNC_OK
