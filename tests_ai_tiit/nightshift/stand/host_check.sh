#!/bin/bash
for p in 27017 27018 3000; do
  if timeout 3 bash -c "</dev/tcp/host.docker.internal/$p" 2>/dev/null; then
    echo "$p REACHABLE"
  else
    echo "$p BLOCKED"
  fi
done