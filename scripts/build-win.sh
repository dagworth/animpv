#!/usr/bin/env bash
# electron-builder downloads extra tools mid-run (winCodeSign, nsis, ...) the
# first time it needs them, so a single patch-nix-elf.sh pass beforehand
# can't catch binaries that don't exist yet. Retry a few times, repatching
# the electron-builder cache after every failure, until nothing new shows up.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

max_attempts=5
attempt=1
while true; do
  bash "$dir/scripts/patch-nix-elf.sh"
  if npx electron-builder --win; then
    exit 0
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "build-win: electron-builder still failing after $attempt attempts" >&2
    exit 1
  fi
  echo "build-win: retrying after repatching electron-builder cache ($attempt/$max_attempts)" >&2
  attempt=$((attempt + 1))
done
