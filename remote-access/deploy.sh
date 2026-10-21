#!/usr/bin/env bash
# Выкладка с работы: тот же release.sh, что дома, только вход на сервер через VPS (datacore-vm из ~/.ssh/config).
# Запуск из любой папки репо:  bash remote-access/deploy.sh      (флаги release.sh, напр. --data, передаются как есть)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
VM=datacore-vm KEY="$HOME/.ssh/datacore_work" bash deploy/synology/release.sh "$@"
