#!/usr/bin/env bash
# Repatches prebuilt Linux ELF binaries pulled in by npm/electron-builder so
# they can run on NixOS, which has no /lib64/ld-linux-x86-64.so.2 or system
# library cache for generic-Linux binaries to find at their hardcoded paths.
# Run inside the project's `nix develop` shell, which sets NIX_LD and
# NIX_LD_LIBRARY_PATH (see flake.nix).
set -euo pipefail

if [ -z "${NIX_LD:-}" ] || [ -z "${NIX_LD_LIBRARY_PATH:-}" ]; then
  echo "patch-nix-elf: NIX_LD/NIX_LD_LIBRARY_PATH not set - are you inside 'nix develop'?" >&2
  exit 0
fi

patch_dir() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  while IFS= read -r -d '' f; do
    interp=$(patchelf --print-interpreter "$f" 2>/dev/null) || continue
    case "$interp" in
      /nix/store/*) continue ;; # already patched
    esac
    chmod u+w "$f"
    patchelf --set-interpreter "$NIX_LD" --set-rpath "$NIX_LD_LIBRARY_PATH" "$f"
    echo "patch-nix-elf: patched $f"
  done < <(find "$dir" -type f -print0)
}

patch_dir "node_modules/7zip-bin"
patch_dir "node_modules/app-builder-bin"
patch_dir "${ELECTRON_BUILDER_CACHE:-$HOME/.cache/electron-builder}"
