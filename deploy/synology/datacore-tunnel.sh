#!/bin/bash
# datacore-tunnel.sh — обратный SSH-туннель data-core: VPS 127.0.0.1:4201 → VM 127.0.0.1:3001.
# Отдельный от kppdf-tunnel (тот держит 4200 → 3000 и не трогается).
# На VPS nginx отдаёт https://<домен>/db/ → 127.0.0.1:4201 (см. deploy/synology/README.md «Публичный доступ»).
#
# Запуск — из crontab пользователя деплоя (без sudo), каждую минуту; flock не даёт поднять вторую копию,
# autossh сам переподключается:
#   * * * * * VPS_TARGET=root@<vps-ip> /bin/bash /opt/data-core/deploy/synology/datacore-tunnel.sh >/dev/null 2>&1
# VPS_TARGET в репозиторий не пишется.
set -euo pipefail

: "${VPS_TARGET:?VPS_TARGET (user@host) не задан}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_PORT="${REMOTE_PORT:-4201}"
LOCAL_PORT="${LOCAL_PORT:-3001}"

export AUTOSSH_GATETIME=0
exec flock -n /tmp/datacore-tunnel.lock \
  autossh -M 0 -N \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new \
    -i "$SSH_KEY" \
    -R "127.0.0.1:${REMOTE_PORT}:127.0.0.1:${LOCAL_PORT}" \
    "$VPS_TARGET"
