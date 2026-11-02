#!/bin/bash
HOSTIP=$(grep -o 'host([0-9.]*' /etc/resolv.conf | head -1 | sed 's/host(//')
echo "hostip=$HOSTIP"
for port in 27017 27018 3000; do
  if timeout 3 bash -c "</dev/tcp/$HOSTIP/$port" 2>/dev/null; then
    echo "$port REACHABLE"
  else
    echo "$port BLOCKED"
  fi
done