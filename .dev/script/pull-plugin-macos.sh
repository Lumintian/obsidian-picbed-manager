#!/bin/zsh
# Pull Picbed Manager build artifacts onto macOS for Obsidian testing.
#
# Copy this file to:
#   <vault>/.obsidian/dev/script/pull-plugin-macos.sh
# then:
#   chmod +x pull-plugin-macos.sh
#   ./pull-plugin-macos.sh
#
# If the copy lives under <vault>/.obsidian/dev/script/, the plugin directory
# is inferred automatically. Otherwise the PICBED_PLUGIN_DIR env var is used.
#
# Usage:
#   ./pull-plugin-macos.sh              # rsync main.js, manifest.json, styles.css
#   ./pull-plugin-macos.sh --build      # remote pnpm build, then rsync
#   ./pull-plugin-macos.sh --dry-run    # print rsync plan only
#   ./pull-plugin-macos.sh --build -n   # remote build + dry-run rsync
#
# Environment overrides:
#   PICBED_REMOTE       user@host          (default: user@remote)
#   PICBED_REMOTE_SRC   remote plugin dir  (default: /path/to/obsidian-picbed-manager)
#   PICBED_PLUGIN_DIR   local plugin dir   (default: inferred or $HOME/Vault/.obsidian/plugins/picbed-manager)

set -euo pipefail

REMOTE="${PICBED_REMOTE:-user@remote}"
REMOTE_SRC="${PICBED_REMOTE_SRC:-/path/to/obsidian-picbed-manager}"
LOCAL_PLUGIN_DIR="${PICBED_PLUGIN_DIR:-}"
PLUGIN_FILES=(main.js manifest.json styles.css)

DO_BUILD=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Pull Picbed Manager artifacts from a remote build host onto macOS.

  ./pull-plugin-macos.sh [--build] [--dry-run|-n] [--help|-h]

  --build       ssh to the build host and run `pnpm build` first
  --dry-run, -n rsync dry-run (no writes)
  --help, -h    show this help

Expected location on this machine:
  <vault>/.obsidian/dev/script/pull-plugin-macos.sh

Plugin destination:
  <vault>/.obsidian/plugins/picbed-manager/

Environment variables for custom setups:
  PICBED_REMOTE       SSH remote host (e.g., user@build-host)
  PICBED_REMOTE_SRC   Remote repository root path
  PICBED_PLUGIN_DIR   Local plugin installation directory override

Does not delete data.json or other local plugin state.
After a successful pull, reload Obsidian (command palette:
"Reload app without saving") and enable Picbed Manager if needed.
EOF
}

resolve_plugin_dir() {
  if [[ -n "${PICBED_PLUGIN_DIR:-}" ]]; then
    print -r -- "$PICBED_PLUGIN_DIR"
    return
  fi

  local script_dir
  script_dir="${0:A:h}"
  if [[ "${script_dir:t}" == "script" && "${script_dir:h:t}" == "dev" ]]; then
    print -r -- "${script_dir:h:h}/plugins/picbed-manager"
    return
  fi

  if [[ -n "$LOCAL_PLUGIN_DIR" ]]; then
    print -r -- "$LOCAL_PLUGIN_DIR"
    return
  fi

  print -u2 "Error: Could not resolve plugin destination directory."
  print -u2 "Please place this script under <vault>/.obsidian/dev/script/ or set PICBED_PLUGIN_DIR."
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) DO_BUILD=1 ;;
    --dry-run|-n) DRY_RUN=1 ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      print -u2 "Unknown argument: $1"
      usage >&2
      exit 2
      ;;
  esac
  shift
done

for cmd in ssh rsync; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    print -u2 "Missing required command: $cmd"
    exit 1
  fi
done

PLUGIN_DIR="$(resolve_plugin_dir)"

if [[ $DO_BUILD -eq 1 ]]; then
  print "Building on $REMOTE ..."
  ssh "$REMOTE" "cd $(printf '%q' "$REMOTE_SRC") && pnpm build"
fi

RSYNC_FLAGS=(-av)
if [[ $DRY_RUN -eq 1 ]]; then
  RSYNC_FLAGS+=(-n)
fi

sources=()
for file in "${PLUGIN_FILES[@]}"; do
  sources+=("$REMOTE:$REMOTE_SRC/$file")
done

if [[ $DRY_RUN -eq 0 ]]; then
  mkdir -p "$PLUGIN_DIR"
fi

print "Syncing ${#PLUGIN_FILES[@]} files"
print "  from $REMOTE:$REMOTE_SRC"
print "  to   $PLUGIN_DIR"
rsync "${RSYNC_FLAGS[@]}" "${sources[@]}" "$PLUGIN_DIR/"

if [[ $DRY_RUN -eq 1 ]]; then
  print "Dry-run complete. Re-run without --dry-run to write files."
  exit 0
fi

print "Synced:"
ls -l "$PLUGIN_DIR"/main.js "$PLUGIN_DIR"/manifest.json "$PLUGIN_DIR"/styles.css
print "Reload Obsidian to pick up the new build."
