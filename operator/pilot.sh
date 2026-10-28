#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $(id -u) == 0 ]]; then
  printf '%s\n' 'Run the isolated pilot as the nonroot development user.' >&2
  exit 1
fi
exec prlimit --cpu=240:245 --nofile=96:96 --fsize=41943040:41943040 -- \
  node --max-old-space-size=192 --use-env-proxy --import tsx src/pilot.ts "$@"
