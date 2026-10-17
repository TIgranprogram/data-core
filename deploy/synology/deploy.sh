#!/usr/bin/env bash
# KPPDF 8.0 — one-command deploy (Linux / macOS / Git Bash)
# Usage (from repo root):
#   ./deploy/synology/deploy.sh
#   ./deploy/synology/deploy.sh --seed
#   ./deploy/synology/deploy.sh --wipe --seed
#   ./deploy/synology/deploy.sh --skip-build

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

echo ""
echo "=== KPPDF 8.0 deploy.sh ==="
echo "  Root: $ROOT"
echo ""

if [[ ! -f "$HERE/config.env" ]]; then
  echo "[FAIL] Missing deploy/synology/config.env"
  echo "  cp deploy/synology/config.env.example deploy/synology/config.env"
  echo "  Fill secrets, then re-run. See deploy/synology/README.md"
  exit 1
fi

if ! python3 -c "import paramiko" 2>/dev/null && ! python -c "import paramiko" 2>/dev/null; then
  echo "Installing paramiko..."
  pip3 install -r "$HERE/requirements.txt" || pip install -r "$HERE/requirements.txt"
fi

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python

for arg in "$@"; do
  if [[ "$arg" == "--wipe" ]]; then
    echo "WARNING: --wipe will DELETE app + mongo data on the VM."
    echo "Only use while the system is NOT in real production use."
  fi
done

echo "$PY deploy/synology/deploy.py $*"
exec "$PY" "$HERE/deploy.py" "$@"
