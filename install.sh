#!/usr/bin/env bash
# .statusline installer — copies hook into place and wires Claude Code's settings.json.
#
# Usage:
#   bash install.sh              # interactive, asks before each step
#   bash install.sh --yes        # non-interactive, backups made automatically
#   bash install.sh --uninstall  # restore the most recent .bak

set -euo pipefail

REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HOOK_SRC="$REPO_ROOT/hook/statusline.js"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HOOK_DEST="$CLAUDE_DIR/hooks/statusline.js"
SETTINGS="$CLAUDE_DIR/settings.json"
YES=0
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --help|-h)
      sed -n '2,6p' "$0"; exit 0 ;;
  esac
done

confirm() {
  local msg="$1"
  if [ "$YES" -eq 1 ]; then return 0; fi
  read -r -p "$msg [Y/n] " reply
  [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]]
}

if [ "$UNINSTALL" -eq 1 ]; then
  latest_bak="$(ls -t "$HOOK_DEST".bak.* 2>/dev/null | head -1 || true)"
  if [ -z "$latest_bak" ]; then
    echo "No backup found. Nothing to restore." >&2
    exit 1
  fi
  if confirm "Restore $latest_bak to $HOOK_DEST?"; then
    cp "$latest_bak" "$HOOK_DEST"
    echo "Restored."
  fi
  exit 0
fi

# Preflight
if [ ! -f "$HOOK_SRC" ]; then
  echo "Hook source missing: $HOOK_SRC" >&2
  exit 1
fi
mkdir -p "$CLAUDE_DIR/hooks"

# Back up any existing hook
if [ -f "$HOOK_DEST" ]; then
  bak="$HOOK_DEST.bak.$(date +%Y%m%d-%H%M%S)"
  if confirm "Existing hook found. Back it up to $bak and replace?"; then
    cp "$HOOK_DEST" "$bak"
  else
    echo "Aborted." >&2
    exit 1
  fi
fi

# Install hook
cp "$HOOK_SRC" "$HOOK_DEST"
echo "Installed hook → $HOOK_DEST"

# Wire settings.json
cmd="node \"$HOOK_DEST\""
if [ -f "$SETTINGS" ]; then
  if grep -q '"statusLine"' "$SETTINGS"; then
    echo "settings.json already has a statusLine entry. Leaving it alone."
    echo "If you want to point it at this hook, edit $SETTINGS so statusLine.command = $cmd"
  else
    # Append a statusLine block. Keep it minimal — users can merge by hand if they have a fancy config.
    if confirm "Add statusLine block to $SETTINGS?"; then
      python3 - "$SETTINGS" "$cmd" <<'PY'
import json, sys
path, cmd = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f: data = json.load(f)
data.setdefault('statusLine', {'type': 'command', 'command': cmd})
with open(path, 'w', encoding='utf-8') as f: json.dump(data, f, indent=2)
PY
      echo "Updated settings.json."
    fi
  fi
else
  if confirm "No $SETTINGS found. Create one with statusLine wired up?"; then
    cat > "$SETTINGS" <<EOF
{
  "statusLine": {
    "type": "command",
    "command": "$cmd"
  }
}
EOF
    echo "Created $SETTINGS."
  fi
fi

cat <<EOF

Done. Start a new Claude Code session to see the statusline.

Optional toggles:
  touch $CLAUDE_DIR/.caveman-active       # turn [CAVEMAN] badge on
  rm    $CLAUDE_DIR/.caveman-active       # turn it off
  echo "3/7" > $CLAUDE_DIR/.enforcer-preview   # preview [ENFORCER] without a real ledger
  rm    $CLAUDE_DIR/.enforcer-preview     # turn preview off

Playground:
  open $REPO_ROOT/playground/index.html
EOF
