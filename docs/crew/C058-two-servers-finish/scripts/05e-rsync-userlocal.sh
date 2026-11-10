#!/usr/bin/env bash
set -euo pipefail

put_rsync() {
  local name="$1"; shift
  echo "== $name"
  "$@" 'bash -s' <<'EOF'
set -euo pipefail
mkdir -p "$HOME/bin" "$HOME/bin/rsync-lib"
if command -v rsync >/dev/null 2>&1 && [[ "$(command -v rsync)" != "$HOME/bin/rsync" ]]; then
  rsync --version | head -1; echo RSYNC_SYSTEM
elif [[ -x "$HOME/bin/rsync.bin" ]] || [[ -x "$HOME/bin/rsync" ]]; then
  # починить права если root от прошлого запуска
  docker run --rm -v "$HOME/bin:/out" alpine:3.20 chown -R "$(id -u):$(id -g)" /out || true
  chmod +x "$HOME/bin/rsync" "$HOME/bin/rsync.bin" 2>/dev/null || true
  if PATH="$HOME/bin:$PATH" rsync --version >/dev/null 2>&1; then
    PATH="$HOME/bin:$PATH" rsync --version | head -1; echo RSYNC_HOME
  else
    echo NEED_REINSTALL
  fi
fi
if ! PATH="$HOME/bin:/usr/bin:/bin" rsync --version >/dev/null 2>&1; then
  docker run --rm -v "$HOME/bin:/out" debian:bookworm-slim bash -c '
    set -e
    apt-get update -qq
    apt-get install -y -qq rsync >/dev/null
    cp -a /usr/bin/rsync /out/rsync.bin
    mkdir -p /out/rsync-lib
    for lib in $(ldd /usr/bin/rsync | awk "/=> \//{print \$3}"); do
      base=$(basename "$lib")
      case "$base" in
        libc.so*|libm.so*|libdl.so*|ld-linux*|libpthread*|librt.so*|libresolv*) ;;
        *) cp -a "$lib" /out/rsync-lib/ 2>/dev/null || true ;;
      esac
    done
    chown -R '"$(id -u):$(id -g)"' /out
  '
  cat > "$HOME/bin/rsync" <<'W'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="$DIR/rsync-lib:${LD_LIBRARY_PATH:-}"
exec "$DIR/rsync.bin" "$@"
W
  chmod +x "$HOME/bin/rsync" "$HOME/bin/rsync.bin"
  PATH="$HOME/bin:$PATH" rsync --version | head -1
  echo RSYNC_INSTALLED
fi
line='* * * * * PATH=$HOME/bin:/usr/bin:/bin DATA_DIR=/var/lib/datacore /bin/bash /opt/data-core/deploy/ha/switch/switch-watch.sh >/dev/null 2>&1'
(crontab -l 2>/dev/null | grep -v switch-watch.sh; echo "$line") | crontab -
crontab -l | grep switch-watch
PATH="$HOME/bin:/usr/bin:/bin" command -v rsync
PATH="$HOME/bin:/usr/bin:/bin" rsync --version | head -1
echo CRON_PATH_OK
EOF
}

put_rsync home ssh -o BatchMode=yes datacore-vm
put_rsync office ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro
echo RSYNC_USERLOCAL_OK
