#!/usr/bin/env bash
# Разовая настройка рабочего ПК (Git Bash):   bash setup-work-pc.sh
# Кладёт ключ «рабочий ПК» в ~/.ssh, дописывает вход datacore-vm в ~/.ssh/config, проверяет связь.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
[[ -f "$HERE/secret/datacore_work" ]] || { echo "Нет $HERE/secret/datacore_work — скопируйте папку remote-access целиком (с secret/)"; exit 1; }

mkdir -p "$HOME/.ssh"
cp "$HERE/secret/datacore_work" "$HOME/.ssh/datacore_work"
cp "$HERE/secret/datacore_work.pub" "$HOME/.ssh/datacore_work.pub"
chmod 600 "$HOME/.ssh/datacore_work"
cp "$HERE/known_hosts" "$HOME/.ssh/datacore_known_hosts"

if ! grep -q "^Host datacore-vm\$" "$HOME/.ssh/config" 2>/dev/null; then
  { echo; cat "$HERE/ssh_config"; } >> "$HOME/.ssh/config"
  echo "Добавлено в ~/.ssh/config: datacore-jump, datacore-vm"
else
  echo "~/.ssh/config уже настроен"
fi
echo
bash "$HERE/check.sh"
