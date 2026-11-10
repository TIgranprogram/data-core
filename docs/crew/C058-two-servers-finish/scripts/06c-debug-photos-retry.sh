#!/usr/bin/env bash
set -eu
echo "== Sportin switch.log"
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro 'tail -40 /var/lib/datacore/switch/switch.log'
echo "== home rsync"
ssh -o BatchMode=yes datacore-vm 'ls -la $HOME/bin/rsync; PATH=$HOME/bin:/usr/bin:/bin rsync --version | sed -n 1p'
echo "== manual photos probe (dry)"
ssh -i "$HOME/.ssh/erp_server" -o BatchMode=yes erpadmin@sportin.netcraze.pro 'bash -s' <<'EOF'
set -a; . /var/lib/datacore/switch/bridge.env; set +a
export PATH="$HOME/bin:/usr/bin:/bin"
# короткий тест ssh peer
eval ${HA_PEER_PROXY:+export RSYNC_RSH="$HA_PEER_PROXY"}
ssh -o BatchMode=yes -o ConnectTimeout=15 ${HA_PEER_PORT:+-p $HA_PEER_PORT} ${HA_PEER_PROXY:+-o ProxyCommand="$HA_PEER_PROXY"} -i "$HA_PEER_KEY" "$HA_PEER_SSH" 'echo PEER_OK; PATH=$HOME/bin:/usr/bin:/bin command -v rsync; ls -la $HOME/bin/rsync'
# rsync --list dry one file
RSH="ssh -o BatchMode=yes ${HA_PEER_PORT:+-p $HA_PEER_PORT} ${HA_PEER_PROXY:+-o ProxyCommand=$HA_PEER_PROXY} -i $HA_PEER_KEY"
timeout 60 rsync --rsync-path='$HOME/bin/rsync' -rtn --ignore-existing -e "$RSH" /var/lib/datacore/uploads/ "${HA_PEER_SSH}:/var/lib/datacore/uploads/" 2>&1 | sed -n '1,20p'
echo RSYNC_PROBE_DONE
EOF
