#!/usr/bin/env bash
set -eu

fix_host() {
  local name="$1"; shift
  echo "== fix $name"
  "$@" 'bash -s' <<'EOF'
set -eu
mkdir -p "$HOME/bin" "$HOME/bin/rsync-lib"
if ! PATH="$HOME/bin:/usr/bin:/bin" rsync --version >/dev/null 2>&1; then
  docker run --rm -v "$HOME/bin:/out" debian:bookworm-slim bash -c "
    set -e
    apt-get update -qq && apt-get install -y -qq rsync >/dev/null
    cp -a /usr/bin/rsync /out/rsync.bin
    mkdir -p /out/rsync-lib
    for lib in \$(ldd /usr/bin/rsync | awk '/=> \//{print \$3}'); do
      base=\$(basename \"\$lib\")
      case \"\$base\" in libc.so*|libm.so*|libdl.so*|ld-linux*|libpthread*|librt.so*|libresolv*) ;;
        *) cp -a \"\$lib\" /out/rsync-lib/ 2>/dev/null || true ;;
      esac
    done
    chown -R $(id -u):$(id -g) /out
  "
  cat > "$HOME/bin/rsync" <<'W'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="$DIR/rsync-lib:${LD_LIBRARY_PATH:-}"
exec "$DIR/rsync.bin" "$@"
W
  chmod +x "$HOME/bin/rsync" "$HOME/bin/rsync.bin"
fi
PATH="$HOME/bin:/usr/bin:/bin" rsync --version >/tmp/rsync-ver.txt
cat /tmp/rsync-ver.txt | sed -n '1p'

SW=/opt/data-core/deploy/ha/switch/switch-watch.sh
cp -a "$SW" "$SW.bak-c058-$(date +%H%M%S)"
# preflight PATH
python3 - <<'PY'
from pathlib import Path
p = Path("/opt/data-core/deploy/ha/switch/switch-watch.sh")
t = p.read_text()
t2 = t.replace(
    'command -v rsync >/dev/null 2>&1 || fail preflight "На этом сервере нет rsync."',
    'PATH="$HOME/bin:/usr/bin:/bin" command -v rsync >/dev/null 2>&1 || fail preflight "На этом сервере нет rsync."',
)
t2 = t2.replace(
    "peer \"$T_SSH\" 'command -v rsync >/dev/null' >/dev/null 2>&1 || fail preflight \"На втором сервере нет rsync.\"",
    "peer \"$T_SSH\" 'PATH=\"$HOME/bin:/usr/bin:/bin\" command -v rsync >/dev/null' >/dev/null 2>&1 || fail preflight \"На втором сервере нет rsync.\"",
)
if "--rsync-path=" not in t2:
    t2 = t2.replace(
        "rsync -rt --ignore-existing",
        'PATH="$HOME/bin:/usr/bin:/bin" rsync --rsync-path="$HOME/bin/rsync" -rt --ignore-existing',
    )
    t2 = t2.replace(
        "rsync -a --delete",
        'PATH="$HOME/bin:/usr/bin:/bin" rsync --rsync-path="$HOME/bin/rsync" -a --delete',
    )
    t2 = t2.replace(
        "rsync -a -e",
        'PATH="$HOME/bin:/usr/bin:/bin" rsync --rsync-path="$HOME/bin/rsync" -a -e',
    )
p.write_text(t2)
print("PATCHED", p)
PY
grep -n rsync "$SW" | sed -n '1,25p'
line='* * * * * PATH=$HOME/bin:/usr/bin:/bin DATA_DIR=/var/lib/datacore /bin/bash /opt/data-core/deploy/ha/switch/switch-watch.sh >/dev/null 2>&1'
(crontab -l 2>/dev/null | grep -v switch-watch.sh; echo "$line") | crontab -
echo FIX_OK
EOF
}

fix_host home ssh -o BatchMode=yes datacore-vm
fix_host office ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro
echo RSYNC_PATH_FIX_OK
