#!/usr/bin/env bash
# --rsync-path должен раскрывать HOME на УДАЛЁННОЙ стороне.
set -eu

patch_sw() {
  "$@" 'bash -s' <<'EOF'
set -eu
SW=/opt/data-core/deploy/ha/switch/switch-watch.sh
python3 - <<'PY'
from pathlib import Path
p = Path("/opt/data-core/deploy/ha/switch/switch-watch.sh")
t = p.read_text()
t = t.replace('--rsync-path="$HOME/bin/rsync"', "--rsync-path='$HOME/bin/rsync'")
p.write_text(t)
print("patched quotes")
PY
grep -n 'rsync-path' "$SW"
# гарантировать ~/bin/rsync
mkdir -p "$HOME/bin"
if ! [[ -x "$HOME/bin/rsync" ]]; then
  if command -v rsync >/dev/null 2>&1; then
    ln -sf "$(command -v rsync)" "$HOME/bin/rsync"
  fi
fi
ls -la "$HOME/bin/rsync" || true
"$HOME/bin/rsync" --version 2>/dev/null | sed -n '1p' || true
echo HOST_OK
EOF
}

echo "== home"
patch_sw ssh -o BatchMode=yes datacore-vm
echo "== office"
patch_sw ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro
echo RSYNC_REMOTE_HOME_OK
