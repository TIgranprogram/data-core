#!/usr/bin/env bash
set -eu
fix_host() {
  local name="$1"; shift
  echo "== $name"
  "$@" 'bash -s' <<'EOF'
set -eu
SW=/opt/data-core/deploy/ha/switch/switch-watch.sh
python3 - <<'PY'
from pathlib import Path
p = Path("/opt/data-core/deploy/ha/switch/switch-watch.sh")
t = p.read_text()
# убрать кривой "timeout … PATH=… rsync" → "timeout … env PATH=… rsync"
t = t.replace(
    'timeout "$(cap "$1")" PATH="$HOME/bin:/usr/bin:/bin" rsync',
    'timeout "$(cap "$1")" env PATH="$HOME/bin:/usr/bin:/bin" rsync',
)
t = t.replace(
    'timeout "$(cap "$T_CODE")" PATH="$HOME/bin:/usr/bin:/bin" rsync',
    'timeout "$(cap "$T_CODE")" env PATH="$HOME/bin:/usr/bin:/bin" rsync',
)
# схлопнуть двойной PATH= в preflight
t = t.replace(
    'PATH="$HOME/bin:/usr/bin:/bin" PATH="$HOME/bin:/usr/bin:/bin" command -v rsync',
    'PATH="$HOME/bin:/usr/bin:/bin" command -v rsync',
)
p.write_text(t)
print("OK")
PY
grep -n 'timeout.*rsync\|command -v rsync' "$SW"
echo FIX2_OK
EOF
}
fix_host home ssh -o BatchMode=yes datacore-vm
fix_host office ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro
echo ALL_FIX2_OK
